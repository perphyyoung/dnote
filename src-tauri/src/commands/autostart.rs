//! 开机自启：把前端存下的偏好落到系统上（Windows 写 `HKCU\...\Run`）。
//!
//! 为什么在 Rust 侧做、而不是像 cdown 那样前端直调插件 JS API：
//! - 前端看不见「无人值守」开关（`DNOTE_NO_TRAY` 是后端环境变量），而 **e2e 绝不能写用户机器的
//!   注册表** —— 4 个并行实例会抢着改同一项，还会把机器留在被改过的状态；
//! - 顺带也就不需要前端 npm 依赖与 `capabilities` 权限。
//!
//! 与 cdown 的另一处不同：**偏好源在前端**（localStorage，缺省 = 开），注册表只是它的执行结果。
//! 因为要「默认开 + 能关掉」——注册表表达不了「默认」：用户关掉后 Run 项就没了，下次启动会以为
//! 从没开过、又给打开。
//!
//! dev 构建**不写注册表**：把调试二进制的路径写进 Run 项对用户没有意义，验收只在 release 做。

use tauri::AppHandle;
use tauri_plugin_autostart::ManagerExt;

use crate::domain::error::CommandError;

/// 本次是否允许真的动注册表：无人值守（e2e 注入 `DNOTE_NO_TRAY`）与 dev 构建都不许。
/// 复用托盘那个开关 —— 它在本项目里的含义就是「无人值守场景」（见 `infra/tray.rs`）。
fn may_touch_registry() -> bool {
    !cfg!(debug_assertions) && crate::infra::tray::enabled()
}

fn to_error(e: impl std::fmt::Display) -> CommandError {
    CommandError::Message(format!("开机自启设置失败: {e}"))
}

/// 应用开机自启设置，并**回读实际状态**（前端据此判断要不要回滚开关）。
///
/// 不允许动注册表时**原样回显 `on`**（不读注册表）：那是「本环境不生效」，不是「设置失败」——
/// 若回读真实值，dev 里开关会被自己打回去，e2e 的判据也会随机器状态飘。
#[tauri::command]
#[specta::specta]
pub fn set_autostart(app: AppHandle, on: bool) -> Result<bool, CommandError> {
    let autolaunch = app.autolaunch();
    if !may_touch_registry() {
        crate::log_info!("跳过开机自启设置（dev 构建 / 无人值守场景），按意图回显 {on}");
        return Ok(on);
    }
    if on {
        autolaunch.enable().map_err(to_error)?;
    } else {
        autolaunch.disable().map_err(to_error)?;
    }
    let actual = autolaunch.is_enabled().map_err(to_error)?;
    crate::log_info!("开机自启已设为 {on}（实际 {actual}）");
    Ok(actual)
}
