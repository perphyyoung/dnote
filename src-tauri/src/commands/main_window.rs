//! 主窗口显隐：托盘与单例唤起共用。
//!
//! 不是 `#[tauri::command]`——只在 Rust 侧被调用；前端隐藏窗口走 `core:window:allow-hide`
//! 权限直调 `getCurrentWindow().hide()`。
//!
//! 文件名叫 `main_window` 而不是 `window`：`src/bindings.ts`（tauri-specta 生成物）里有
//! `import("@tauri-apps/api/window")`，sentrux 的导入解析按后缀匹配，`window.rs` 会被误判成
//! 「bindings.ts 引用了后端业务代码」而报违规（见 `.sentrux/rules.toml` 与 `开发经验.md`）。

use tauri::{AppHandle, Manager};

/// 唤起主窗口并聚焦（托盘「显示」、二次启动的单例回调）。
pub fn show_main_window(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

/// 把主窗口收回托盘（托盘左键点击、header 的 `-` 按钮）。
pub fn hide_main_window(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.hide();
    }
}
