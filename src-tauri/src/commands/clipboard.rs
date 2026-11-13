//! 剪贴板：文字 + 私有格式（行颜色）。
//!
//! 复制时同时写两份：`CF_UNICODETEXT`（外部应用只认这个，保持“外部只拿文字”）与
//! `dnote.line-colors.v1`（UTF-8 JSON，仅 dnote 自己读）。格式名是**系统级**的，
//! 所以 dev 与 release 两个进程能互通，不需要共享数据目录。
//!
//! 为什么不用 text/html 或零宽字符：前者会被 Word 之类的富文本应用吃掉颜色，
//! 后者会污染外部拿到的纯文本。自定义格式是唯一“外部看不见、内部读得到”的口径。
//!
//! 剪贴板是全局单例，别的进程随时可能占着它 —— 所有打开动作统一重试；写失败时
//! 优先保住文字，颜色载荷只是附加项。

use std::sync::atomic::{AtomicU32, Ordering};
use std::time::Duration;

use windows::core::w;
use windows::Win32::Foundation::{GlobalFree, HANDLE, HGLOBAL};
use windows::Win32::System::DataExchange::{
    CloseClipboard, EmptyClipboard, GetClipboardData, OpenClipboard, RegisterClipboardFormatW,
    SetClipboardData,
};
use windows::Win32::System::Memory::{
    GlobalAlloc, GlobalLock, GlobalSize, GlobalUnlock, GMEM_MOVEABLE,
};

use crate::domain::error::CommandError;

/// `CF_UNICODETEXT` 的稳定值（Win32 常量，不随编译环境变化）
const CF_UNICODETEXT: u32 = 13;
/// 载荷上限：行颜色最多几百行，1 MiB 足够；超了就当没有载荷，防止恶意剪贴板撑爆内存。
const MAX_PAYLOAD: usize = 1024 * 1024;
const OPEN_RETRIES: usize = 10;
const OPEN_RETRY_MS: u64 = 15;

/// 读出来的剪贴板内容：文字已统一成 LF；载荷是前端 JSON 原文，Rust 不解析字段。
#[derive(serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardRead {
    pub text: String,
    pub payload: Option<String>,
}

/// 打开剪贴板并在离开作用域时关闭 —— 任何提前 return 都不会漏关。
struct ClipboardGuard;

impl Drop for ClipboardGuard {
    fn drop(&mut self) {
        // SAFETY: 只在 open_with_retry 成功之后构造，成对调用。
        unsafe {
            let _ = CloseClipboard();
        }
    }
}

fn open_with_retry() -> Result<ClipboardGuard, CommandError> {
    for _ in 0..OPEN_RETRIES {
        // SAFETY: OpenClipboard 没有额外前置条件；失败通常只是别的进程正占着剪贴板。
        if unsafe { OpenClipboard(None) }.is_ok() {
            return Ok(ClipboardGuard);
        }
        std::thread::sleep(Duration::from_millis(OPEN_RETRY_MS));
    }
    Err(CommandError::Message(
        "剪贴板被其它程序占用，请稍后重试".to_string(),
    ))
}

fn format_id() -> u32 {
    static ID: AtomicU32 = AtomicU32::new(0);
    let cached = ID.load(Ordering::Relaxed);
    if cached != 0 {
        return cached;
    }
    // SAFETY: 传的是以 NUL 结尾的静态宽字符串。
    let id = unsafe { RegisterClipboardFormatW(w!("dnote.line-colors.v1")) };
    ID.store(id, Ordering::Relaxed);
    id
}

/// 把字节拷进 `GMEM_MOVEABLE` 的全局内存块，返回可交给 `SetClipboardData` 的句柄。
/// 成功后所有权归系统，**不能**再 `GlobalFree`。
fn alloc_global(bytes: &[u8]) -> windows::core::Result<HGLOBAL> {
    // SAFETY: 分配、加锁、拷贝、解锁都围绕同一个句柄；拷贝长度取自 bytes。
    unsafe {
        let handle = GlobalAlloc(GMEM_MOVEABLE, bytes.len())?;
        let ptr = GlobalLock(handle);
        if ptr.is_null() {
            let _ = GlobalFree(Some(handle));
            return Err(windows::core::Error::from_thread());
        }
        std::ptr::copy_nonoverlapping(bytes.as_ptr(), ptr as *mut u8, bytes.len());
        let _ = GlobalUnlock(handle);
        Ok(handle)
    }
}

/// `CF_UNICODETEXT` 要 CRLF 分段；末尾补 NUL。外部应用（记事本 / Word）才认得出换行。
fn utf16_clipboard_bytes(text: &str) -> Vec<u8> {
    let crlf = text.replace('\n', "\r\n");
    let mut units: Vec<u16> = crlf.encode_utf16().collect();
    units.push(0);
    units.iter().flat_map(|unit| unit.to_le_bytes()).collect()
}

/// 复制文本，附带可选的 JSON 载荷（行颜色）。
///
/// 载荷写失败只记日志、不向上报错：文字已经进了剪贴板，用户至少能正常复制；
/// 颜色丢掉是可接受的降级（例如剪贴板被安全软件限制）。
#[tauri::command]
#[specta::specta]
pub fn copy_text_with_colors(text: String, payload: Option<String>) -> Result<(), CommandError> {
    let _guard = open_with_retry()?;

    // SAFETY: 已在 open_with_retry 里取得剪贴板所有权，下面所有句柄都在同一会话内使用。
    unsafe {
        EmptyClipboard().map_err(|e| CommandError::Message(format!("清空剪贴板失败：{e}")))?;

        let text_handle = alloc_global(&utf16_clipboard_bytes(&text))
            .map_err(|e| CommandError::Message(format!("写入剪贴板文字失败：{e}")))?;
        if let Err(e) = SetClipboardData(CF_UNICODETEXT, Some(HANDLE(text_handle.0))) {
            let _ = GlobalFree(Some(text_handle));
            return Err(CommandError::Message(format!("写入剪贴板文字失败：{e}")));
        }

        let Some(payload) = payload.filter(|body| !body.is_empty() && body.len() <= MAX_PAYLOAD)
        else {
            return Ok(());
        };
        let format = format_id();
        if format == 0 {
            log::warn!("注册剪贴板自定义格式失败：行颜色不会随复制携带");
            return Ok(());
        }
        match alloc_global(payload.as_bytes()) {
            Ok(handle) => {
                if let Err(e) = SetClipboardData(format, Some(HANDLE(handle.0))) {
                    let _ = GlobalFree(Some(handle));
                    log::warn!("写入行颜色载荷失败（文字不受影响）：{e}");
                }
            }
            Err(e) => log::warn!("分配行颜色载荷内存失败（文字不受影响）：{e}"),
        }
    }

    Ok(())
}

/// 读剪贴板：文字（CRLF → LF）与可选的行颜色载荷。
///
/// 文字读不到就返回空串（前端会回落到 `clipboardData` 里同步拿到的那份）。
#[tauri::command]
#[specta::specta]
pub fn read_clipboard() -> Result<ClipboardRead, CommandError> {
    let _guard = open_with_retry()?;

    // SAFETY: 剪贴板已打开；句柄只在本次会话内使用，解锁后不再解引用。
    unsafe {
        let text = read_clipboard_text();
        let payload = read_clipboard_payload();
        Ok(ClipboardRead { text, payload })
    }
}

/// 读 `CF_UNICODETEXT`，遇到 NUL 结束；顺手把 CRLF / 单独的 CR 统一成 LF。
unsafe fn read_clipboard_text() -> String {
    let Ok(handle) = GetClipboardData(CF_UNICODETEXT) else {
        return String::new();
    };
    let memory = HGLOBAL(handle.0);
    let ptr = GlobalLock(memory);
    if ptr.is_null() {
        return String::new();
    }
    let mut len = 0usize;
    let units = ptr as *const u16;
    // 上限只是防坏数据死循环；正常文本远小于它。
    while len < 10_000_000 && *units.add(len) != 0 {
        len += 1;
    }
    let text = String::from_utf16_lossy(std::slice::from_raw_parts(units, len));
    let _ = GlobalUnlock(memory);
    text.replace("\r\n", "\n").replace('\r', "\n")
}

/// 读自定义格式；格式不存在 / 读失败 / 超长都当作“没有颜色”。
unsafe fn read_clipboard_payload() -> Option<String> {
    let format = format_id();
    if format == 0 {
        return None;
    }
    let handle = GetClipboardData(format).ok()?;
    let memory = HGLOBAL(handle.0);
    let ptr = GlobalLock(memory);
    if ptr.is_null() {
        return None;
    }
    let size = GlobalSize(memory);
    let bytes = if size == 0 || size > MAX_PAYLOAD {
        None
    } else {
        Some(std::slice::from_raw_parts(ptr as *const u8, size).to_vec())
    };
    let _ = GlobalUnlock(memory);
    bytes.map(|body| String::from_utf8_lossy(&body).into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn utf16_uses_crlf_and_nul_terminator() {
        let bytes = utf16_clipboard_bytes("甲\n乙");
        let units: Vec<u16> = bytes
            .chunks_exact(2)
            .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
            .collect();
        assert_eq!(units.last(), Some(&0));
        let text = String::from_utf16(&units[..units.len() - 1]).unwrap();
        assert_eq!(text, "甲\r\n乙");
    }
}
