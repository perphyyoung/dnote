# dnote

**Draggable Note** — 极简桌面记事本：一行一条笔记，拖拽即可调整上下顺序，顺序完全手动。

本文件是**使用与上手文档**：这是什么、怎么跑起来、怎么用。方案与依赖取舍见 [dnote起步方案.md](dnote起步方案.md)；界面与交互硬约定见 [design.md](design.md)；日志见 [日志使用说明.md](日志使用说明.md)；踩过的坑见 [开发经验.md](开发经验.md)。

## 技术栈

- **桌面框架**：Tauri 2
- **前端**：Vue 3 + TypeScript + Tailwind CSS 3 + Vite 6
- **存储**：纯文本文件（`<数据目录>/dnote.txt`，一行一条，临时文件 + rename 原子写）

## 功能

- **一行一条笔记**：每行就是一个无边框输入框，点哪儿都能直接改，没有卡片、表头、保存按钮。
- **拖拽调序**：按住行首悬停出现的拖拽点上下拖动即可调整位置，拖动中其余行自动让位。
- **顺序完全手动**：不做任何自动排序（不按时间、不按字母），顺序只由拖拽决定，重启后保持。
- **允许空行**：空行是合法内容，原样存储、原样显示，不做任何自动清理。
- **存储内容 = 界面内容**：后台存的就是这些行本身，没有 id、没有序号、没有时间戳；`dnote.txt` 可以直接用记事本打开核对。
- **行操作**：回车在本行下方插入空行；空行上退格或点「×」删除该行。
- **多行复制**：按住鼠标从一行拖到另一行即选中整个行区间（反向拖同样成立），Ctrl+C 复制成对应的多行文本；单行内的文字选择与复制仍是原生行为。
- **多行粘贴**：一次粘贴进来多行文本（如从别的编辑器复制一段）会自动拆成多行，而不是被压成一行。
- **置顶**：默认置顶，右上角图钉一键切换，选择会被记住。
- **托盘常驻**：标题栏「-」或托盘左键切换显示 / 隐藏，托盘右键「显示 / 退出」。
- **单实例（仅 release）**：正式构建同时只允许一个窗口，二次启动唤起已有窗口；开发构建不抢单实例锁，不会和常驻的 release 实例打架。
- **窗口记忆**：尺寸与位置重启后恢复。
- **深色主题**：默认深色，无亮色与主题切换。

## 快速开始

前置要求：Rust、Node（pnpm）、Windows WebView2。

```sh
# 安装前端依赖
pnpm install

# 开发模式（启动 Vite + Tauri 窗口）
pnpm dev

# 构建（等效 tauri build，NSIS 安装包）
pnpm release
```

## 数据与存储

- 笔记存于 `<数据目录>/dnote.txt`，**一行一条，行序即顺序**；文件内容与界面逐行一致。
- 数据目录：dev 在 `<项目根>/dnote-data/`（`DNOTE_DATA_DIR` 可重定向），release 在应用配置目录（`%APPDATA%\com.dnote.perphyyoung`），两种构建互不共享。
- 行格式：每行都以 `\n` 结尾（含最后一行）；读取时按 `\n` 切分并丢弃末尾由终止换行产生的空串，兼容手改出来的 CRLF。这样末尾空行也能原样往返（原因见 `开发经验.md`）。
- 写入是**整文件重写**，走 `dnote.txt.tmp` + `rename` 原子替换，异常退出最多丢最后一个防抖窗口（400ms）。
- 窗口尺寸 / 位置由官方 `tauri-plugin-window-state` 存于应用配置目录（release 为 `.window-state.json`，dev 为 `window-state.dev.json`）。

## 开发环境

当前**只在 Windows 上开发与验证**（Tauri 2 + WebView2）。macOS / Linux 未测试——不是「不支持」，而是没有验证过。

工具链：

- **Windows + WebView2**（随 Edge 安装，通常已具备）；
- **Rust**：最低版本见 `src-tauri/Cargo.toml` 的 `rust-version`；
- **pnpm 12**：版本已固定在 `package.json` 的 `packageManager`，请勿用其它大版本安装依赖（会改写 `pnpm-lock.yaml`）；
- **`CARGO_TARGET_DIR`**：指向共享目录，与其它 Tauri 项目共用编译产物；共享 target 是全局一把锁，多项目不能并行 build。
- **dev 与 release 并存**：单实例锁只在 release 注册，`pnpm dev` 随时可起，不必先关掉已安装的 dnote（可用 release 版常驻记需求、dev 版并行开发）。dev 之间则并存不了 —— vite 的 `strictPort` 会占住 1420，第二个 `pnpm dev` 直接报端口占用。

## 常用命令

质量门唯一入口是 `pnpm check`（format → build:rs → gen:bindings → typecheck → build）；改完代码先跑它，通过后再按需跑测试。

| 命令 | 内容 |
| --- | --- |
| `pnpm dev` | 开发模式（Vite + Tauri，debug 构建自动导出 `src/bindings.ts`） |
| `pnpm check` | 质量门：format → build:rs → gen:bindings → typecheck → build |
| `pnpm test` | 全部单元测试（vitest 纯逻辑 + cargo test） |
| `pnpm test:ui` / `pnpm test:rs` | 只跑前端 / 只跑 Rust 单测 |
| `pnpm e2e` | Playwright e2e（CDP 连真实调试二进制，先自动构建一次） |
| `pnpm build:rs` / `pnpm gen:bindings` | 手动重编 Rust / 复写 `src/bindings.ts` |
| `pnpm release` | 构建安装包（NSIS） |

`src/bindings.ts` 是 tauri-specta 运行期导出的生成物：不手改、不入格式化，Rust 命令签名变更后由 `pnpm check` / `pnpm dev` 自动复写。

换图标：`node scripts/gen-icon.mjs && pnpm tauri icon app-icon.png`，再把产物 `icon.png` 拷成 `public/icon.png` 作 favicon。

换 dev 图标：`node scripts/gen-dev-icon.mjs`（默认生成 `src-tauri/icons/tray-dev.rgba` + 两张预览图）。dev 构建的托盘与任务栏都用它，release 用应用图标；脚本与 Rust 样板都是通用的，可整段复制到别的 Tauri 项目。

## 文档

| 文件 | 内容 |
| --- | --- |
| `dnote起步方案.md` | 定位、技术栈、依赖取舍、数据与命令、交互设计、实施步骤、已确认的取舍 |
| `design.md` | 界面与交互硬约定（主题、行、拖拽、删除确认、极简口径） |
| `通用语言.md` | DDD 统一语言：术语的中英对照与命名口径 |
| `日志使用说明.md` | 日志文件位置、级别开关、前后端打点方式 |
| `开发经验.md` | 踩过的坑与「为什么」 |
| `AGENTS.md` | 给 AI 协作者的规则、环境要点与结构速记 |

## 许可

GPL-3.0
