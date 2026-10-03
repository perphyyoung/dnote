//! `hotkey.rs` 的纯逻辑：切换判定与长按过滤。
//!
//! 真热键那半边（插件注册、系统按下）在单测里跑不了，靠手工验收：在别的窗口前台按
//! `Ctrl+Alt+N` 应唤出并聚焦、再按一次收回托盘，日志里有 `全局热键已注册：Ctrl+Alt+N`。

use super::{is_in_front, HotkeyHeld};

#[test]
fn front_window_only_when_visible_focused_and_not_minimized() {
    assert!(is_in_front(true, false, true)); // 正显示在前台 → 收回托盘
    assert!(!is_in_front(false, false, false)); // 藏在托盘 → 唤起
    assert!(!is_in_front(true, true, false)); // 最小化 → 唤起（顺带 unminimize）
    assert!(!is_in_front(true, false, false)); // 可见但被别的程序压住 → 唤起
}

#[test]
fn held_flag_only_fires_on_fresh_press() {
    let held = HotkeyHeld::default();
    assert!(held.press()); // 松手状态下的按下 = 一次有效切换
    assert!(!held.press()); // 长按的自动重复 → 忽略，免得窗口反复开合
    held.release();
    assert!(held.press()); // 松手后再按
}
