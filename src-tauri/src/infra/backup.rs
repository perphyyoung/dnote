//! 笔记备份包（zip）：把两份笔记打包 / 解包，供设置面板的「导出 / 导入」用。
//!
//! 为什么放 infra：这里全是**文件格式**知识 —— 包内文本必须与 store 的逐行编码逐字节一致
//! （`encode_lines` / `decode_lines`），否则「导出再导入」得到的文件与原件不等价。
//! 对话框、路径与编排在 `commands/backup.rs`。
//!
//! 包内结构（固定）：
//! - `dnote.txt` / `dnote-secondary.txt`：两份笔记，根级、与 store 的文件名同名（解压即见）；
//! - `manifest.toml`：清单（app / format / 导出时间 / 两个文件名）—— **必须存在**。
//!   它既是「这确实是 dnote 导出的包」的凭据，也是「哪份是主、哪份是次级」的依据：
//!   一个装着任意两个 txt 的 zip 无从定位主次，所以缺清单直接拒绝，不做宽容解析。
//!   条目名以清单里写的为准（我们写的时候就是下面两个常量）。

use std::fs::File;
use std::io::{Read, Write};
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::infra::store::{decode_lines, encode_lines, MAIN_NOTES_FILE, SECONDARY_NOTES_FILE};

/// 认领用的应用标识与包格式版本（结构变了就 +1）
pub const BACKUP_APP: &str = "dnote";
pub const BACKUP_FORMAT: u32 = 1;
/// 包内清单文件名
pub const MANIFEST_FILE: &str = "manifest.toml";
/// 单个条目的解压上限（笔记是纯文本，8MB 远超正常用量；防 zip 炸弹）
const MAX_ENTRY_BYTES: u64 = 8 * 1024 * 1024;

#[derive(Debug, Serialize, Deserialize)]
pub struct Manifest {
    pub app: String,
    pub format: u32,
    pub exported_at: String,
    pub main_file: String,
    pub secondary_file: String,
}

#[derive(Debug, thiserror::Error)]
pub enum BackupError {
    #[error("备份文件读写失败：{0}")]
    Io(#[from] std::io::Error),
    #[error("备份文件不是有效的 zip：{0}")]
    Zip(#[from] zip::result::ZipError),
    #[error("这个 zip 不是 dnote 的笔记备份（缺少 {MANIFEST_FILE}）")]
    MissingManifest,
    #[error("备份里没有 {0}")]
    MissingEntry(String),
    #[error("备份清单里的条目名不合法：{0}")]
    BadEntryName(String),
    #[error("备份里的 {name} 过大（超过 {MAX_ENTRY_BYTES} 字节），拒绝解压")]
    TooLarge { name: String },
    #[error("备份里的 {name} 不是 UTF-8 文本")]
    NotUtf8 { name: String },
    #[error("备份清单无法解析：{0}")]
    Manifest(String),
    #[error("这个 zip 不是 dnote 的笔记备份（清单里写的是 {0}）")]
    ForeignApp(String),
}

/// 打包：两份笔记 + 清单 → zip（deflate）
pub fn write_backup(path: &Path, main: &[String], secondary: &[String]) -> Result<(), BackupError> {
    let manifest = Manifest {
        app: BACKUP_APP.to_string(),
        format: BACKUP_FORMAT,
        exported_at: chrono::Local::now().to_rfc3339(),
        main_file: MAIN_NOTES_FILE.to_string(),
        secondary_file: SECONDARY_NOTES_FILE.to_string(),
    };
    let mut zip = zip::ZipWriter::new(File::create(path)?);
    let opts = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);
    zip.start_file(MAIN_NOTES_FILE, opts)?;
    zip.write_all(encode_lines(main).as_bytes())?;
    zip.start_file(SECONDARY_NOTES_FILE, opts)?;
    zip.write_all(encode_lines(secondary).as_bytes())?;
    zip.start_file(MANIFEST_FILE, opts)?;
    zip.write_all(
        toml::to_string(&manifest)
            .map_err(|e| BackupError::Manifest(e.to_string()))?
            .as_bytes(),
    )?;
    zip.finish()?;
    Ok(())
}

/// 解包：读出两份笔记（顺序固定：主、次级）。**清单必须在**（见文件头）
pub fn read_backup(path: &Path) -> Result<(Vec<String>, Vec<String>), BackupError> {
    let mut zip = zip::ZipArchive::new(File::open(path)?)?;
    let manifest: Manifest = toml::from_str(&read_entry(&mut zip, MANIFEST_FILE)?)
        .map_err(|e| BackupError::Manifest(e.to_string()))?;
    if manifest.app != BACKUP_APP {
        return Err(BackupError::ForeignApp(manifest.app));
    }
    // 条目名以清单为准：它才是「哪份是主、哪份是次级」的出处，别拿固定的文件名去猜
    let main_entry = entry_name(&manifest.main_file)?;
    let secondary_entry = entry_name(&manifest.secondary_file)?;
    let main = decode_lines(&read_entry(&mut zip, &main_entry)?);
    let secondary = decode_lines(&read_entry(&mut zip, &secondary_entry)?);
    Ok((main, secondary))
}

/// 清单里的条目名必须是不带路径的纯文件名（我们写出去的就是根级两个文件）
fn entry_name(name: &str) -> Result<String, BackupError> {
    if name.is_empty() || name.contains(['/', '\\']) {
        return Err(BackupError::BadEntryName(name.to_string()));
    }
    Ok(name.to_string())
}

/// 读一个条目为 UTF-8 文本：先按上限截断读（不信 zip 头里声明的 size），再校验编码。
/// 条目不在包里时给 MissingManifest 让位（清单本身的缺失有专属错误）。
fn read_entry(zip: &mut zip::ZipArchive<File>, name: &str) -> Result<String, BackupError> {
    let entry = zip.by_name(name).map_err(|_| {
        if name == MANIFEST_FILE {
            BackupError::MissingManifest
        } else {
            BackupError::MissingEntry(name.to_string())
        }
    })?;
    let mut bytes = Vec::new();
    entry.take(MAX_ENTRY_BYTES + 1).read_to_end(&mut bytes)?;
    if bytes.len() as u64 > MAX_ENTRY_BYTES {
        return Err(BackupError::TooLarge {
            name: name.to_string(),
        });
    }
    String::from_utf8(bytes).map_err(|_| BackupError::NotUtf8 {
        name: name.to_string(),
    })
}

#[cfg(test)]
#[path = "backup.test.rs"]
mod tests;
