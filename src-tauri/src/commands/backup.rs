//! 笔记备份的「导出 / 导入」命令：选路径（原生文件对话框）→ 交给 `infra::backup` 打包 / 解包。
//!
//! 三条口径：
//! - **对话框在 Rust 侧**：只服务这两条命令，`capabilities` 无需开 dialog 权限（与开机自启、
//!   全局热键同一种做法 —— 前端不直调插件 JS API）；
//! - **命令不写笔记**：导入只把解出来的两份文本**返回**给前端，由前端确认后再落盘
//!   （前端那份文本才是唯一事实源，见 AGENTS.md；用户没确认前一个字节都不写）；
//! - `DNOTE_BACKUP_PATH`（存在且非空）**跳过文件对话框**、直接用该路径 —— e2e 靠它跑通全流程
//!   （与 `DNOTE_NO_TRAY` / `DNOTE_DATA_DIR` 同一套 seam 写法）。

use std::path::PathBuf;

use serde::Serialize;
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

use crate::domain::error::CommandError;

/// 导入时返回给前端的两份笔记（顺序固定：主、次级）
#[derive(Debug, Serialize, specta::Type)]
pub struct BackupNotes {
    pub main: Vec<String>,
    pub secondary: Vec<String>,
}

fn to_error(e: impl std::fmt::Display) -> CommandError {
    CommandError::Message(format!("笔记备份失败：{e}"))
}

/// e2e seam：非空即跳过文件对话框（导出与导入共用同一个路径）
fn seam_path() -> Option<PathBuf> {
    std::env::var("DNOTE_BACKUP_PATH")
        .ok()
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
}

/// 等文件对话框返回。插件是回调式的，这里用一次性通道把它接回 async 命令；
/// 不能在 async 命令里用 `blocking_*`（那会占死运行时的工作线程）。
async fn pick_file(
    app: &AppHandle,
    title: &str,
    default_name: Option<String>,
    save: bool,
) -> Option<PathBuf> {
    if let Some(path) = seam_path() {
        crate::log_info!("DNOTE_BACKUP_PATH 已设置：跳过文件对话框，直接用 {path:?}");
        return Some(path);
    }
    let (tx, mut rx) = tauri::async_runtime::channel(1);
    let mut builder = app.dialog().file().set_title(title);
    if let Some(name) = default_name {
        builder = builder.set_file_name(name);
    }
    builder = builder.add_filter("dnote 笔记备份 (zip)", &["zip"]);
    if save {
        builder.save_file(move |picked| {
            let _ = tx.blocking_send(picked);
        });
    } else {
        builder.pick_file(move |picked| {
            let _ = tx.blocking_send(picked);
        });
    }
    rx.recv()
        .await
        .flatten()
        .and_then(|file| file.as_path().map(PathBuf::from))
}

/// 导出：把前端传来的两份笔记打包成 zip，返回落盘路径；用户取消时返回 None。
///
/// 笔记内容由**前端传入**（它是唯一事实源）：前端会先 `flushNow()`，所以盘上与导出内容一致。
#[tauri::command]
#[specta::specta]
pub async fn export_notes_backup(
    app: AppHandle,
    main: Vec<String>,
    secondary: Vec<String>,
) -> Result<Option<String>, CommandError> {
    // 精确到秒：同一天连导多次，默认文件名也不会撞。分隔符用 `-` 而不是 `:` ——
    // Windows 文件名不允许冒号。
    let default_name = format!(
        "dnote-notes-{}.zip",
        chrono::Local::now().format("%Y%m%d-%H%M%S")
    );
    let Some(path) = pick_file(&app, "导出笔记备份", Some(default_name), true).await else {
        crate::log_info!("导出笔记备份：用户取消");
        return Ok(None);
    };
    crate::infra::backup::write_backup(&path, &main, &secondary).map_err(to_error)?;
    let shown = path.display().to_string();
    crate::log_info!(
        "笔记备份已导出：{shown}（主 {} 行 / 次级 {} 行）",
        main.len(),
        secondary.len()
    );
    Ok(Some(shown))
}

/// 导入：选 zip 并解出两份笔记返回给前端（**不落盘** —— 由前端确认后写入）。
#[tauri::command]
#[specta::specta]
pub async fn import_notes_backup(app: AppHandle) -> Result<Option<BackupNotes>, CommandError> {
    let Some(path) = pick_file(&app, "导入笔记备份", None, false).await else {
        crate::log_info!("导入笔记备份：用户取消");
        return Ok(None);
    };
    let (main, secondary) = crate::infra::backup::read_backup(&path).map_err(to_error)?;
    crate::log_info!(
        "笔记备份已解析：{}（主 {} 行 / 次级 {} 行）",
        path.display(),
        main.len(),
        secondary.len()
    );
    Ok(Some(BackupNotes { main, secondary }))
}
