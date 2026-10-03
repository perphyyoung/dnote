//! 尺寸下限的两段纯计算：① `apply_min_size` 交给系统的外框下限（`track_size`）；
//! ② `ensure_min_size` 的下限判定与目标尺寸（`clamped_size`）。
//!
//! 真窗口那半边（`set_min_size` / `set_size`）在单测里跑不了，交给手工验收：把窗口往小拖到
//! 极限时客户区停在下限、日志不再刷 warn；连按两次 `Win+D` 后窗口不受影响、退出后看状态
//! 文件里 `main` 仍是正常尺寸（见 `开发经验.md`）。

use super::{clamped_size, track_size, SizeBounds};
use tauri::{LogicalSize, PhysicalSize};

/// 取值同 `tauri.conf.json`：下限 260×200、默认 360×480
fn bounds() -> SizeBounds {
    SizeBounds {
        min_width: 260.0,
        min_height: 200.0,
        width: 360.0,
        height: 480.0,
    }
}

#[test]
fn track_size_adds_the_measured_frame() {
    // 实测边框：左右合计 16、上下合计 9（无边框 + 可缩放窗口那圈不可见缩放边框）。
    // 系统拦的是外框，所以下限要按这个补出去，客户区才真的停在配置值上 ——
    // 日志里 244×480 / 360×191 正是"没补"时客户区能到的地方（见 `开发经验.md`）。
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
    // 被 Show Desktop 写坏的就是这一档（实测 144×19，见 `开发经验.md`）
    assert_eq!(
        clamped_size(PhysicalSize::new(144, 19), 1.0, bounds()),
        Some(LogicalSize::new(360.0, 480.0))
    );
}

#[test]
fn size_at_or_above_floor_is_left_alone() {
    // 正好等于下限、以及用户自己拖出来的合法尺寸，都不该被改
    assert_eq!(
        clamped_size(PhysicalSize::new(260, 200), 1.0, bounds()),
        None
    );
    assert_eq!(
        clamped_size(PhysicalSize::new(600, 900), 1.0, bounds()),
        None
    );
}

#[test]
fn floor_is_logical_pixels_so_dpi_matters() {
    // 配置是逻辑像素：150% 缩放下，下限的物理尺寸是 390×300
    assert_eq!(
        clamped_size(PhysicalSize::new(300, 250), 1.5, bounds()),
        Some(LogicalSize::new(360.0, 480.0))
    );
    assert_eq!(
        clamped_size(PhysicalSize::new(390, 300), 1.5, bounds()),
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
