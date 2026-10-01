//! 统一错误类型：命令层返回 `Result<T, CommandError>`，序列化为可读字符串给前端。

use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum CommandError {
    #[error("存储错误: {0}")]
    Store(String),
    #[error("{0}")]
    Message(String),
}

impl From<crate::infra::store::StoreError> for CommandError {
    fn from(e: crate::infra::store::StoreError) -> Self {
        CommandError::Store(e.to_string())
    }
}

impl Serialize for CommandError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

/// 跨 IPC 时 CommandError 序列化为一个字符串；specta 类型同样按 string 建模，
/// 使 tauri-specta 生成的绑定中错误分支为 string。
impl specta::Type for CommandError {
    fn definition(types: &mut specta::Types) -> specta::datatype::DataType {
        <String as specta::Type>::definition(types)
    }
}
