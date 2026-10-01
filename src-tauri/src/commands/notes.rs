//! 笔记命令：只有「读全部行」与「整文件重写」两条。
//!
//! 前端是行数组的唯一事实源（编辑/插入/删除/拖拽都在前端本地完成），
//! 顺序就是数组顺序，因此后端不需要 id、序号或时间戳。

use tauri::State;

use crate::domain::error::CommandError;
use crate::infra::store::Store;

/// 读取全部行；行序即界面顺序，前端不再排序。
#[tauri::command]
#[specta::specta]
pub fn load_notes(store: State<'_, Store>) -> Result<Vec<String>, CommandError> {
    Ok(store.read_lines()?)
}

/// 整文件重写（临时文件 + rename 原子替换）。
#[tauri::command]
#[specta::specta]
pub fn save_notes(store: State<'_, Store>, lines: Vec<String>) -> Result<(), CommandError> {
    store.write_lines(&lines)?;
    Ok(())
}
