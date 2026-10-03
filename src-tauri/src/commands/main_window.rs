//! 主窗口显隐与尺寸下限：托盘、单例唤起、启动兜底共用。
//!
//! 不是 `#[tauri::command]`——只在 Rust 侧被调用；前端隐藏窗口走 `core:window:allow-hide`
//! 权限直调 `getCurrentWindow().hide()`。
//!
//! 文件名叫 `main_window` 而不是 `window`：`src/bindings.ts`（tauri-specta 生成物）里有
//! `import("@tauri-apps/api/window")`，sentrux 的导入解析按后缀匹配，`window.rs` 会被误判成
//! 「bindings.ts 引用了后端业务代码」而报违规（见 `.sentrux/rules.toml` 与 `开发经验.md`）。

use tauri::{AppHandle, LogicalSize, Manager, PhysicalSize, WebviewWindow};

/// 唤起主窗口并聚焦（托盘「显示」、二次启动的单例回调）。
pub fn show_main_window(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        // 尺寸兜底：从最小化 / 托盘唤回时，顺带把被壳写坏的几何修好（见 `ensure_min_size`）
        let _ = ensure_min_size(&w);
        let _ = w.set_focus();
    }
}

/// 把主窗口收回托盘（托盘左键点击、header 的 `-` 按钮）。
pub fn hide_main_window(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.hide();
    }
}

/// 配置里读出来的窗口尺寸（**逻辑像素**，与 `tauri.conf.json` 同单位）。
#[derive(Clone, Copy, Debug, PartialEq)]
struct SizeBounds {
    min_width: f64,
    min_height: f64,
    width: f64,
    height: f64,
}

/// 主窗口尺寸的下限兜底：当前尺寸小于配置下限就改回**默认尺寸**，返回是否动过。
///
/// `apply_min_size` 已经让系统拦住正常拖动，为什么还需要它：
/// - `tauri-plugin-window-state` 在 `WindowEvent::Resized` 时把事件里的尺寸直接记进缓存
///   （退出时落盘），守卫只有「非最小化 / 非最大化」，**没有尺寸下限校验** —— 壳（Show
///   Desktop 等）给一个几十像素的几何事件就能把几何写坏，重启按坏值恢复、退出又原样存回，
///   自锁（见 `开发经验.md`「Win+D 会把窗口几何写坏」）。
/// - 而系统下限**管不住程序化 `set_size`**：状态文件里那份 144×19 照样能恢复出来。
/// 所以启动时（以及从托盘唤回时）再兜一道 —— 坏值在窗口上只停留一瞬，插件下次保存拿到的
/// 已是修正后的值。
///
/// 运行中**不挂**尺寸监控：正常拖动已经被系统下限拦住，再盯一遍只会与用户的手抢着改尺寸
/// （日志里那 30 条连发的成因，见 `开发经验.md`）。
///
/// 配置里没写 `minWidth` / `minHeight` 就不兜底 —— 没有下限，任何尺寸都可能是用户的本意。
pub fn ensure_min_size(window: &WebviewWindow) -> tauri::Result<bool> {
    let Some(bounds) = window_bounds(window) else {
        return Ok(false);
    };
    let current = window.inner_size()?;
    let Some(target) = clamped_size(current, window.scale_factor()?, bounds) else {
        return Ok(false);
    };
    crate::log_warn!(
        "窗口尺寸 {}×{} 低于下限 {}×{}(逻辑像素)，已恢复为默认尺寸",
        current.width,
        current.height,
        bounds.min_width,
        bounds.min_height
    );
    window.set_size(target)?;
    Ok(true)
}

/// 把「配置的客户区下限」真正落到系统上（启动时调一次）。
///
/// 为什么不能只靠配置里的 `minWidth` / `minHeight`：tao 在无边框窗口上会先把 `WS_SIZEBOX`
/// 摘掉再算 `WM_GETMINMAXINFO`（`platform_impl/windows/util.rs` 的 `adjust_window_rect`），
/// 于是那个值被当成**外框**下限设了出去 —— 而无边框 + 可缩放的窗口真的有那圈不可见缩放边框，
/// 客户区因此能再小一圈（实测左右合计 16、上下合计 9）。表现就是"正常拖到极限，客户区已经
/// 小于配置值"（日志里 `244×480`、`360×191`，见 `开发经验.md`）。
///
/// 做法：把实测到的边框补进下限再交给系统 —— 设出去的外框下限 = 客户区下限 + 边框，客户区
/// 于是拖不到配置值以下。全用物理像素传，避开逻辑 / 物理换算的舍入。
pub fn apply_min_size(window: &WebviewWindow) -> tauri::Result<()> {
    let Some(bounds) = window_bounds(window) else {
        return Ok(()); // 与 `ensure_min_size` 同一套判断：没配下限就不设
    };
    let scale = window.scale_factor()?;
    let inner_min = PhysicalSize::new(
        (bounds.min_width * scale).round() as u32,
        (bounds.min_height * scale).round() as u32,
    );
    let inner = window.inner_size()?;
    let outer = window.outer_size()?;
    let frame = PhysicalSize::new(
        outer.width.saturating_sub(inner.width),
        outer.height.saturating_sub(inner.height),
    );
    let track = track_size(inner_min, frame);
    crate::log_info!(
        "窗口最小尺寸设为 {}×{}（客户区下限 {}×{} + 边框 {}×{}）",
        track.width,
        track.height,
        inner_min.width,
        inner_min.height,
        frame.width,
        frame.height
    );
    window.set_min_size(Some(track))
}

/// 交给系统的「外框下限」= 配置的客户区下限 + 实测边框厚度（纯计算，可单测）。
fn track_size(inner_min: PhysicalSize<u32>, frame: PhysicalSize<u32>) -> PhysicalSize<u32> {
    PhysicalSize::new(
        inner_min.width + frame.width,
        inner_min.height + frame.height,
    )
}

/// 从主窗口配置里读尺寸边界（配置值是**逻辑像素**）；缺 min 就返回 `None`（不兜底）。
fn window_bounds(window: &WebviewWindow) -> Option<SizeBounds> {
    let config = window.config();
    let cfg = config
        .app
        .windows
        .iter()
        .find(|w| w.label == window.label())
        .or_else(|| config.app.windows.first())?;
    Some(SizeBounds {
        min_width: cfg.min_width?,
        min_height: cfg.min_height?,
        width: cfg.width,
        height: cfg.height,
    })
}

/// 兜底的纯计算（可单测）：低于下限就给目标尺寸，达标给 `None`。
///
/// 目标取「默认尺寸」，但用下限兜住 —— 万一配置把默认值写得比下限还小，直接按下限设，
/// 否则 `set_size` 触发的新一轮判定还是「低于下限」，会来回震荡。
fn clamped_size(
    current: PhysicalSize<u32>,
    scale: f64,
    bounds: SizeBounds,
) -> Option<LogicalSize<f64>> {
    if f64::from(current.width) >= bounds.min_width * scale
        && f64::from(current.height) >= bounds.min_height * scale
    {
        return None;
    }
    Some(LogicalSize::new(
        bounds.width.max(bounds.min_width),
        bounds.height.max(bounds.min_height),
    ))
}

#[cfg(test)]
#[path = "main_window.test.rs"]
mod tests;
