//! 主窗口显隐：托盘与单例唤起共用。
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
/// 为什么需要：`tauri-plugin-window-state` 在 `WindowEvent::Resized` 时把事件里的尺寸直接
/// 记进缓存（退出时落盘），守卫只有「非最小化 / 非最大化」，**没有尺寸下限校验** —— 壳
/// （Show Desktop 等）给一个几十像素的几何事件就能把窗口几何写坏，重启按坏值恢复、退出又
/// 原样存回，自锁（见 `开发经验.md`「Win+D 会把窗口几何写坏」）。这里兜一道，坏值在窗口上
/// 只停留一瞬，插件下次保存拿到的已是修正后的值。
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

/// 运行中挂上同一道兜底：只在 `Resized` 时判定，且**只信当前尺寸**。
///
/// 为什么不省：壳发起的改尺寸没有固定时机，只在启动时兜一次不够（见 `ensure_min_size`）。
/// 最小化时直接跳过 —— 那时的尺寸不代表恢复后的样子。`set_size` 会再触发一轮 `Resized`，
/// 而那一轮尺寸已达标、判定为「不用动」，所以不会来回震荡。
pub fn watch_min_size(window: &WebviewWindow) {
    let watched = window.clone();
    window.on_window_event(move |event| {
        if !matches!(event, tauri::WindowEvent::Resized(_))
            || watched.is_minimized().unwrap_or(false)
        {
            return;
        }
        let _ = ensure_min_size(&watched);
    });
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
