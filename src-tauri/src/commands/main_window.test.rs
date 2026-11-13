//! 三处纯计算：① `apply_min_size` 交给系统的外框下限（`track_size`）；② `ensure_min_size` 的
//! 下限判定与目标尺寸（`clamped_size`）；③ 托盘左键该收回还是唤起（`tray_should_hide`）。
//!
//! 真窗口那半边（`set_min_size` / `set_size` / 真点一次托盘）在单测里跑不了，交给手工验收：
//! 把窗口往小拖到极限时客户区停在下限、日志不再刷 warn；连按两次 `Win+D` 后窗口不受影响、退出后
//! 看状态文件里 `main` 仍是正常尺寸；未置顶 + 别的窗口在前台时点一次托盘就应到前台（日志里那行
//! `托盘左键：… → 收回/唤起`）。详见 `开发经验.md` §1.6 / §4.7。

use super::{clamped_size, track_size, tray_should_hide, SizeBounds, TRAY_FRONT_GRACE};
use std::time::Duration;
use tauri::{LogicalSize, PhysicalSize};

/// 取值同 `tauri.conf.json`：下限 520×200、默认 520×480
fn bounds() -> SizeBounds {
    SizeBounds {
        min_width: 520.0,
        min_height: 200.0,
        width: 520.0,
        height: 480.0,
    }
}

#[test]
fn track_size_adds_the_measured_frame() {
    // 实测边框：左右合计 16、上下合计 9（无边框 + 可缩放窗口那圈不可见缩放边框）。
    // 系统拦的是外框，所以下限要按这个补出去，客户区才真的停在配置值上 ——
    // 日志里 244×480 / 360×191 正是"没补"时客户区能到的地方（见 `开发经验.md` §1.6）。
    assert_eq!(
        track_size(PhysicalSize::new(260, 200), PhysicalSize::new(16, 9)),
        PhysicalSize::new(276, 209)
    );
}

#[test]
fn track_size_is_config_min_when_frame_is_zero() {
    // 还没成形、或本来就没有缩放边框时（frame = 0）就是配置值本身，不该凭空变大
    assert_eq!(
        track_size(PhysicalSize::new(260, 200), PhysicalSize::new(0, 0)),
        PhysicalSize::new(260, 200)
    );
}

#[test]
fn tiny_size_goes_back_to_default() {
    // 被 Show Desktop 写坏的就是这一档（实测 144×19，见 `开发经验.md` §1.6）
    assert_eq!(
        clamped_size(PhysicalSize::new(144, 19), 1.0, bounds()),
        Some(LogicalSize::new(520.0, 480.0))
    );
}

#[test]
fn size_at_or_above_floor_is_left_alone() {
    // 正好等于下限、以及用户自己拖出来的合法尺寸，都不该被改
    assert_eq!(
        clamped_size(PhysicalSize::new(520, 200), 1.0, bounds()),
        None
    );
    assert_eq!(
        clamped_size(PhysicalSize::new(600, 900), 1.0, bounds()),
        None
    );
}

#[test]
fn floor_is_logical_pixels_so_dpi_matters() {
    // 配置是逻辑像素：150% 缩放下，下限的物理尺寸是 780×300
    assert_eq!(
        clamped_size(PhysicalSize::new(300, 250), 1.5, bounds()),
        Some(LogicalSize::new(520.0, 480.0))
    );
    assert_eq!(
        clamped_size(PhysicalSize::new(780, 300), 1.5, bounds()),
        None
    );
}

#[test]
fn floor_wins_if_default_is_below_it() {
    // 配置写成「默认比下限还小」时按上限设，否则改完还是「低于下限」，来回震荡
    let odd = SizeBounds {
        min_width: 500.0,
        min_height: 400.0,
        width: 300.0,
        height: 200.0,
    };
    assert_eq!(
        clamped_size(PhysicalSize::new(144, 19), 1.0, odd),
        Some(LogicalSize::new(500.0, 400.0))
    );
}

#[test]
fn tray_left_click_hides_only_when_it_was_just_in_front() {
    // 正看着时点托盘 → 这次点击自己夺焦（实测失焦发生在收到图标消息之前 61ms）→ 收回
    assert!(tray_should_hide(
        true,
        false,
        Some(Duration::from_millis(61))
    ));
    // 早就被别的窗口压住（实测这一类是十几秒到几十分钟）→ 唤起并置前。
    // 这条就是最初那个 bug 的判据：旧实现"只看可见性"，在这里会判成收起，于是要点两次。
    assert!(!tray_should_hide(
        true,
        false,
        Some(Duration::from_secs(17))
    ));
}

#[test]
fn tray_grace_is_inclusive_at_the_boundary() {
    // 恰好等于阈值算"刚刚"，刚过一点都不算 —— 阈值是"<= "而不是"<"
    assert!(tray_should_hide(true, false, Some(TRAY_FRONT_GRACE)));
    assert!(!tray_should_hide(
        true,
        false,
        Some(TRAY_FRONT_GRACE + Duration::from_millis(1))
    ));
}

#[test]
fn tray_never_hides_when_hidden_minimized_or_never_blurred() {
    // 在托盘里 / 最小化 / 本次运行还没失过焦 → 一律唤起（`show_main_window` 顺带 unminimize）
    assert!(!tray_should_hide(
        false,
        false,
        Some(Duration::from_millis(1))
    ));
    assert!(!tray_should_hide(false, false, None));
    assert!(!tray_should_hide(
        true,
        true,
        Some(Duration::from_millis(1))
    ));
    assert!(!tray_should_hide(true, false, None));
}
