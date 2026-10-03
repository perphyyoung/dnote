//! 全局热键 `Ctrl+Alt+N`：唤起 / 收回主窗口。
//!
//! 只在 Rust 侧用插件（不走前端 IPC），故 `capabilities` 无需开 global-shortcut 权限。
//! **不支持重设热键**：键位就是下面那个常量 —— 没有设置项、不落盘、前端也没有相关命令
//! （这一点是它与 cdown 那份的主要差别）。
//!
//! 两条从 cdown 抄来的经验：
//! - **键位不在插件构建期注册**（构建期注册失败会让启动直接失败），而在 `setup` 里注册；
//!   失败只记日志、不影响启动 —— 键可能被别的程序或另一个实例占着。
//! - 长按会连发 `Pressed`，必须靠 `HotkeyHeld` 过滤成「松手后的新一次按下」，否则窗口疯狂开合。

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{AppHandle, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};

use super::main_window::{hide_main_window, show_main_window};

/// 唯一的全局热键。也是日志里打出来的那个串 —— 键位只在这一处出现。
pub const HOTKEY: &str = "Ctrl+Alt+N";

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
/// 抽成纯函数是为了能单测。**只有热键这条路能用 `is_focused`** —— 按热键时窗口不会先失焦；
/// 托盘左键点击则相反（点下去窗口已经失焦），所以托盘那条仍按「可见性」切换，两者别合并。
fn is_in_front(visible: bool, minimized: bool, focused: bool) -> bool {
    visible && !minimized && focused
}

/// 注册全局热键（`setup` 里调一次）。解析失败 / 注册失败都只记日志：热键是锦上添花，
/// 不能因为它让应用起不来。
pub fn register(app: &AppHandle) {
    let shortcut: Shortcut = match HOTKEY.parse() {
        Ok(shortcut) => shortcut,
        Err(e) => {
            crate::log_warn!("全局热键串「{HOTKEY}」无法解析：{e}");
            return;
        }
    };
    match app.global_shortcut().register(shortcut) {
        Ok(()) => crate::log_info!("全局热键已注册：{HOTKEY}"),
        Err(e) => crate::log_warn!("全局热键 {HOTKEY} 注册失败（可能已被占用）：{e}"),
    }
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
