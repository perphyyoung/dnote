//! 当前构建该用的图标：dev 用通用的「DEV」图标，release 用应用自身图标。
//!
//! 这个模块是**项目无关的通用样板**：连同 `icons/tray-dev.rgba`（由 `scripts/gen-dev-icon.mjs`
//! 生成）一起复制到别的 Tauri 项目即可直接用，不需要任何额外依赖或 Cargo feature。产物是裸
//! RGBA，正好是 `Image::new` 要的格式（官方处理 `.ico` 也是构建期解码成裸 RGBA 再 `Image::new`，
//! 见 tauri-codegen 的 `CachedIcon`），因此运行时一个解码器都不需要。
//!
//! 之所以区分：dev 与 release 常同时在一台机器上跑（release 常驻记需求、dev 并行开发），
//! 图标不一样才能一眼认出哪个是哪个。

use tauri::{image::Image, AppHandle};

/// 通用 dev 图标的原始像素与边长，须与 `scripts/gen-dev-icon.mjs` 的默认参数一致。
const DEV_ICON_RGBA: &[u8] = include_bytes!("../../icons/tray-dev.rgba");
const DEV_ICON_SIZE: u32 = 128;

// 编译期挡住「脚本改了尺寸/参数但 Rust 没跟着改」
const _: () = assert!(DEV_ICON_RGBA.len() == (DEV_ICON_SIZE * DEV_ICON_SIZE * 4) as usize);

/// 托盘与任务栏共用的图标。
pub fn icon(app: &AppHandle) -> Image<'_> {
    if cfg!(debug_assertions) {
        Image::new(DEV_ICON_RGBA, DEV_ICON_SIZE, DEV_ICON_SIZE)
    } else {
        app.default_window_icon().expect("缺少应用图标").clone()
    }
}
