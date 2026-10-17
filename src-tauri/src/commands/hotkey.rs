//! 全局热键 `F9`：唤起 / 收回主窗口。
//!
//! 只在 Rust 侧用插件（不走前端 IPC 注册），故 `capabilities` 无需开 global-shortcut 权限。
//! **键位固定（不可自定义），但可在设置面板关掉**：偏好源在前端 localStorage（缺省 = 开，
//! 见 `src/features/settings/globalHotkey.ts`），系统侧只是它的执行结果 —— 所以不在 `setup`
//! 里无条件注册，而是由前端启动时按偏好调 `set_hotkey` 幂等应用一次（与开机自启同一口径，
//! 理由也同源：系统侧只能表达「现在有没有注册」，表达不了「默认开、用户关过」）。
//!
//! 两条从 cdown 抄来的经验：
//! - **键位不在插件构建期注册**（构建期注册失败会让启动直接失败），而在运行期按偏好注册；
//!   失败只记日志、不影响启动 —— 键可能被别的程序或另一个实例占着。**debug 构建里"抢不到"
//!   是预期**（dev 与常驻的 release 同机时，F9 总在 release 手里），所以只记 debug 级；
//!   release 里同样的失败才当 warn（那多半是别的程序抢了这个键）。
//! - 长按会连发 `Pressed`，必须靠 `HotkeyHeld` 过滤成「松手后的新一次按下」，否则窗口疯狂开合。

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{AppHandle, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};

use super::main_window::{hide_main_window, show_main_window};

/// 唯一的全局热键。也是日志里打出来的那个串 —— 键位只在这一处出现。
pub const HOTKEY: &str = "F9";

/// 热键是否处于「按下未松」状态：由它过滤长按的自动重复。
#[derive(Default)]
pub struct HotkeyHeld(AtomicBool);

impl HotkeyHeld {
    /// 是否是「新的一次按下」（上一次已松开）
    pub fn press(&self) -> bool {
        !self.0.swap(true, Ordering::SeqCst)
    }

    pub fn release(&self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

/// 主窗口是否「正被用户看着」：可见 + 未最小化 + 有焦点（三个入参都取自窗口实时状态）。
///
/// 抽成纯函数是为了能单测。**只有热键这条路能用 `is_focused`** —— 按热键不会夺焦，读到的是真事实；
/// 托盘左键点击相反（点击自己就夺焦，`Down` / `Up` 时 `is_focused()` 都已是 `false`），
/// 所以托盘那条改用「最近一次失焦的时刻」当前台的替身（见 `main_window::toggle_from_tray`）。
fn is_in_front(visible: bool, minimized: bool, focused: bool) -> bool {
    visible && !minimized && focused
}

/// 按偏好把全局热键设成「注册」或「注销」，返回**实际**是否处于注册状态（前端据此回滚开关）。
/// 解析失败 / 注册失败都只记日志并返回 `false`：热键是锦上添花，不能因为它让应用起不来；
/// 关掉时连 `HotkeyHeld` 一起复位，否则「按下未松」会跨开关残留、下次按下被当成长按重复。
fn apply(app: &AppHandle, on: bool) -> bool {
    let shortcut: Shortcut = match HOTKEY.parse() {
        Ok(shortcut) => shortcut,
        Err(e) => {
            crate::log_warn!("全局热键串「{HOTKEY}」无法解析：{e}");
            return false;
        }
    };
    if on {
        // 幂等：本进程已注册就当成成功。三个窗口（主 / 设置 / 日历）挂载时都会按偏好应用一次，
        // 重复注册会拿到插件的报错并打出一条假警告。
        if app.global_shortcut().is_registered(shortcut) {
            return true;
        }
        return match app.global_shortcut().register(shortcut) {
            Ok(()) => {
                crate::log_info!("全局热键已注册：{HOTKEY}");
                true
            }
            Err(e) => {
                // dev 与 release 同机时，F9 总在常驻的 release 手里 —— 这是预期，不当作警告：
                // 默认 info 级别下这条不落盘，DNOTE_LOG=debug 才看得到。
                if cfg!(debug_assertions) {
                    crate::log_debug!(
                        "全局热键 {HOTKEY} 注册失败（dev 下常见：release 实例正占着）：{e}"
                    );
                } else {
                    crate::log_warn!("全局热键 {HOTKEY} 注册失败（可能已被占用）：{e}");
                }
                false
            }
        };
    }
    // 注销：本就未注册也算成功 —— 语义是「让它不处于注册状态」，幂等
    if let Err(e) = app.global_shortcut().unregister(shortcut) {
        if cfg!(debug_assertions) {
            crate::log_debug!("全局热键 {HOTKEY} 注销未生效（可能本就未注册）：{e}");
        } else {
            crate::log_warn!("全局热键 {HOTKEY} 注销未生效（可能本就未注册）：{e}");
        }
    }
    if let Some(held) = app.try_state::<HotkeyHeld>() {
        held.release();
    }
    crate::log_info!("全局热键已注销：{HOTKEY}");
    false
}

/// 设置面板的 F9 开关（前端按偏好调用）：把意图落到系统上，并回读实际状态。
#[tauri::command]
#[specta::specta]
pub fn set_hotkey(app: AppHandle, on: bool) -> bool {
    apply(&app, on)
}

/// 热键触发的切换：主窗口正显示在前台 → 收回托盘；其余（托盘中 / 最小化 / 被别的程序压住）
/// → 唤起（`show_main_window` 里已含取消最小化与尺寸兜底）。
pub fn toggle_main_window(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let front = is_in_front(
            w.is_visible().unwrap_or(false),
            w.is_minimized().unwrap_or(false),
            w.is_focused().unwrap_or(false),
        );
        if front {
            hide_main_window(app);
        } else {
            show_main_window(app);
        }
    }
}

#[cfg(test)]
#[path = "hotkey.test.rs"]
mod tests;
