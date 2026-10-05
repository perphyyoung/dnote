//! 纯文本行存储：`<数据目录>/dnote.txt`（主面板）与 `<数据目录>/dnote-secondary.txt`
//! （次级面板），一行一条笔记。
//!
//! 行序即界面顺序，文件内容与界面逐行一致（可以直接用记事本打开核对），
//! 因此不存 id、序号或时间戳。写入走「临时文件 + rename」原子替换。

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// 主面板的笔记文件；文件名只在这里出现一次（`开发经验.md` 里那些 e2e 辅助函数是另一份口径）
pub const MAIN_NOTES_FILE: &str = "dnote.txt";
/// 次级面板的笔记文件。**与主面板分开存**：两块面板的笔记互不牵动，
/// 一个文件被手改坏 / 清空，另一份照旧。
pub const SECONDARY_NOTES_FILE: &str = "dnote-secondary.txt";

#[derive(Debug, thiserror::Error)]
pub enum StoreError {
    #[error("IO 错误: {0}")]
    Io(#[from] std::io::Error),
}

/// 数据目录基准（dnote.txt 所在目录）：
/// - 环境变量 `DNOTE_DATA_DIR` 优先（为 e2e 隔离预留，非空才生效）；
/// - 开发环境（debug）使用项目根下的 `dnote-data`（经 CARGO_MANIFEST_DIR 编译期
///   定位，不依赖进程工作目录——tauri CLI 以 src-tauri 为 cwd 启动 exe）；
/// - 部署环境使用应用配置目录，与 dev 天然分离。
pub fn data_dir(app: &tauri::AppHandle) -> PathBuf {
    use tauri::Manager;
    if let Ok(dir) = std::env::var("DNOTE_DATA_DIR") {
        if !dir.is_empty() {
            return PathBuf::from(dir);
        }
    }
    if cfg!(debug_assertions) {
        project_root().join("dnote-data")
    } else {
        app.path()
            .app_config_dir()
            .expect("failed to resolve app config dir")
    }
}

/// 项目根目录（src-tauri 的上级），经 CARGO_MANIFEST_DIR 编译期定位。
fn project_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| PathBuf::from("."))
}

pub struct Store {
    path: PathBuf,
    lock: Mutex<()>,
}

impl Store {
    pub fn new(path: PathBuf) -> Self {
        Self {
            path,
            lock: Mutex::new(()),
        }
    }

    /// 读取全部行；文件不存在视为空列表。读取与写入共用一把锁。
    pub fn read_lines(&self) -> Result<Vec<String>, StoreError> {
        let _g = self.lock.lock().unwrap();
        self.read_lines_locked()
    }

    /// 整文件重写（原子写），全程持锁。
    pub fn write_lines(&self, lines: &[String]) -> Result<(), StoreError> {
        let _g = self.lock.lock().unwrap();
        self.write_lines_locked(lines)
    }

    fn read_lines_locked(&self) -> Result<Vec<String>, StoreError> {
        if !self.path.exists() {
            return Ok(Vec::new());
        }
        Ok(decode_lines(&fs::read_to_string(&self.path)?))
    }

    fn write_lines_locked(&self, lines: &[String]) -> Result<(), StoreError> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent)?;
        }
        let tmp = self.path.with_extension("txt.tmp");
        fs::write(&tmp, encode_lines(lines))?;
        // Windows 上 std::fs::rename 走 MOVEFILE_REPLACE_EXISTING，可覆盖已存在文件
        fs::rename(&tmp, &self.path)?;
        Ok(())
    }
}

/// 两块面板的笔记存储（每块一个文件）。**作为整体注册给 tauri 的托管状态** ——
/// 托管按类型取，注册两个 `Store` 会撞类型（后一个覆盖前一个），所以包一层。
///
/// 谁用哪块由 `commands::notes::Panel` 决定；这里只做「哪个面板对应哪个文件」。
pub struct NotesStores {
    main: Store,
    secondary: Store,
}

impl NotesStores {
    pub fn new(data_dir: &Path) -> Self {
        Self {
            main: Store::new(data_dir.join(MAIN_NOTES_FILE)),
            secondary: Store::new(data_dir.join(SECONDARY_NOTES_FILE)),
        }
    }

    pub fn main(&self) -> &Store {
        &self.main
    }

    pub fn secondary(&self) -> &Store {
        &self.secondary
    }
}

/// 编码：**每一行都以 `\n` 结尾（含最后一行）**，空列表编码为空串。
///
/// 末尾必须带终止换行，否则末尾的空行无法与「没有这一行」区分：
/// `["a", ""]` 若写成 `"a\n"`，读回来只剩 `["a"]`。
fn encode_lines(lines: &[String]) -> String {
    let mut out = String::new();
    for line in lines {
        out.push_str(line);
        out.push('\n');
    }
    out
}

/// 解码：按 `\n` 切分，去掉每行尾部的 `\r`（兼容手改出来的 CRLF），
/// 并丢弃末尾由终止换行产生的空串。
///
/// 与 `encode_lines` 互为逆运算：`[]` ↔ `""`、`["a"]` ↔ `"a\n"`、
/// `["a", ""]` ↔ `"a\n\n"` 都能精确往返。
fn decode_lines(raw: &str) -> Vec<String> {
    let mut lines: Vec<String> = raw
        .split('\n')
        .map(|l| l.strip_suffix('\r').unwrap_or(l).to_string())
        .collect();
    if lines.last().is_some_and(|l| l.is_empty()) {
        lines.pop();
    }
    lines
}

#[cfg(test)]
#[path = "store.test.rs"]
mod tests;
