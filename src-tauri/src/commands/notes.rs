//! 笔记命令：只有「读全部行」与「整文件重写」两条，**两块面板共用**。
//!
//! 前端是行数组的唯一事实源（编辑/插入/删除/拖拽都在前端本地完成），
//! 顺序就是数组顺序，因此后端不需要 id、序号或时间戳。
//!
//! 主面板与次级面板的差异只有一个参数：`Panel`。这样「所有操作和主面板一样」
//! 是结构上白送的 —— 两条命令、两处调用，不可能只给其中一块面板补了功能。

use tauri::State;

use crate::domain::error::CommandError;
use crate::infra::store::{NotesStores, Store};

/// 哪块面板。序列化成 `"main"` / `"secondary"`（前端 `useNotes` 的 `Panel` 是同一个联合类型）。
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum Panel {
    Main,
    Secondary,
}

impl Panel {
    fn store_of(self, stores: &NotesStores) -> &Store {
        match self {
            Panel::Main => stores.main(),
            Panel::Secondary => stores.secondary(),
        }
    }
}

/// 读取某块面板的全部行；行序即界面顺序，前端不再排序。
#[tauri::command]
#[specta::specta]
pub fn load_notes(
    stores: State<'_, NotesStores>,
    panel: Panel,
) -> Result<Vec<String>, CommandError> {
    Ok(panel.store_of(&stores).read_lines()?)
}

/// 整文件重写某块面板（临时文件 + rename 原子替换）。另一块面板的文件不碰。
#[tauri::command]
#[specta::specta]
pub fn save_notes(
    stores: State<'_, NotesStores>,
    panel: Panel,
    lines: Vec<String>,
) -> Result<(), CommandError> {
    panel.store_of(&stores).write_lines(&lines)?;
    Ok(())
}
