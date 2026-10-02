# AGENTS.md

- 使用中文回答。
- 未说「执行 / 实施」只给方案，不动代码。
- 使用 pnpm，不用 npm；只用 `package.json` 里的命令，不要用变体。
- 修改代码（含测试）后先跑 `pnpm check`（format → build:rs → gen:bindings → typecheck → build），通过后再按需跑 `pnpm test` / `sentrux check .` / `pnpm e2e`；验证通过才以**围栏代码块**输出一行提交信息，格式遵守 `.rules\git提交信息规范.md`。
- 添加必要的注释，说明**为什么**，而非是什么；修改时不要动不相关的注释。
- 优先修改，而非重写；只碰必须改的部分，不顺手「改进」相邻代码或格式。
- 不要假设，不要隐藏困惑：存在多种解释、或发现实现与预期不符时，先提问再动手，不要自行改方案。
- 禁止静默失败：优先抛出异常，其次记错误日志，再次控制台输出。
- 及时删除因本次改动而变得未使用的代码；预先存在的死代码只提醒、不擅自删。
- 单测文件与源文件同目录、前缀相同：Rust `foo.rs` ↔ `foo.test.rs`（源文件末尾用 `#[cfg(test)] #[path = "foo.test.rs"] mod tests;` 声明），前端 `foo.ts` ↔ `foo.test.ts`。
- 如果本轮改动涉及的逻辑可以重构，改完提醒用户是否要重构。

## 搜索要求

- 搜索优先用 zg，其次是 rg / Grep，而不是默认的 grep。
- 已知符号 / 字符串 → 精确检索（最快、零维护）；只知道「干什么、不知道叫什么」→ 语义检索，但结果**必须用精确检索复核**后再下结论。
- 代码结构变动后（目录改名、大批文件搬迁）先跑 `zg index`（增量：补新增与变更文件）；只有索引里仍出现已删除 / 旧路径的命中时，才用 `zg index --rebuild`。

## 文档索引（动手前先看）

| 文件 | 内容 |
| --- | --- |
| `dnote起步方案.md` | 方案与依赖取舍（定位、技术栈、数据与命令、交互设计、实施步骤、已确认的取舍）——**动结构前先看** |
| `design.md` | UI / 交互硬约定（主题、行编辑规则、拖拽、确认弹窗） |
| `通用语言.md` | DDD 统一语言：术语中英对照与命名口径——**起名 / 写文案前先看** |
| `开发经验.md` | 踩过的坑与「为什么」；排查问题先翻这里 |
| `日志使用说明.md` | 日志文件位置、级别开关、前后端打点方式 |
| `.rules\git提交信息规范.md` | 提交信息格式 |
| `.sentrux/rules.toml` | 分层与依赖方向的强制规则（`sentrux check .`）——**改结构前先看** |
| `D:\py-code\paim\tauri2项目起步指南.md` | 跨 tauri 2 项目的配置对齐清单 |

## 环境要点

- 命令一律 **PowerShell 7** 写，串联用 `&&`（失败短路）/ `||`（兜底）。
- 命令输出需要截断时**一律只保留最后 100 行**，不得用其它行数。
- **删除是最后手段**，能用更轻的手段就别删：① 先问「这份文件的事实源在哪」——能由脚本 / 源文件一键重建的（`dist/`、`app-icon.png`、`temp/` 残留）才允许删；② 删前用 `search_content` / `search_file` 确认没有别处引用；③ 只是「不想让它入库」的就用 `.gitignore`（文件已被跟踪时补 `jj file untrack`，例：`src-tauri/icons/tray-dev*.png` 预览图），**不要删**；④ 不是本次任务生成的、或用户可能还要看的，先问再删。
- **日志一律清空、不删除**：需要一份干净的日志就 `Clear-Content <log>`（或 `Set-Content -Path <log> -Value $null`），不要 `Remove-Item` —— 日志的价值在于可回溯，条目凭空消失比内容被覆盖更糟。
- `CARGO_TARGET_DIR` 是**机器级环境变量**，指向共享目录 `D:\cargo-shared-target`；所有指向构建产物的脚本必须读该变量、不得硬编码（`scripts/gen-bindings.mjs` 已是此写法）。共享 target 是**全局一把锁**：与其它 tauri 项目不能并行 build，后者只会 `Blocking waiting for file lock`（等待，不是失败）。
- `src/bindings.ts` 是 tauri-specta 运行期导出的生成物：不手改、不入格式化；改了 Rust 命令签名，跑 `pnpm check` 或 `pnpm dev` 即自动复写。
- `tauri.conf.json` 的取值**以 schema 为准**，不要按 serde 的宽松程度写（窗口 `theme` 必须写大写 `"Dark"`，原因见 `开发经验.md`）。
- dev 数据在 `<项目根>/dnote-data/`，release 在应用配置目录，两种构建互不共享；`DNOTE_DATA_DIR` 只用于重定向数据目录（e2e 靠它给每个实例分数据）。
- **dev 与 release 的图标不同**：dev 的托盘与任务栏都用通用的「红底白字 DEV」图标，release 用应用自身图标 —— 两者常同机并跑，靠图标区分。图标是**裸 RGBA + `Image::new`**（不引 `image-png`/`image-ico`），来源 `scripts/gen-dev-icon.mjs`，Rust 样板在 `infra/tray.rs`；脚本、`icons/tray-dev.rgba`、`tray.rs` 三者都是项目无关的，可整段复制到别的 Tauri 项目（改了 `--size` 必须同步 `tray.rs` 的 `DEV_ICON_SIZE`，否则编译期断言失败）。
- **`DNOTE_NO_TRAY`（存在且非空）不建托盘图标**：e2e 的 `launchApp` 会注入它 —— 并行 4 worker × 每文件一实例，每个都建托盘会塞满系统托盘，而用例又碰不到托盘。**窗口与任务栏图标照旧**。代价是 e2e 里点了 header 的 `-` 隐藏就再没有唤回入口，所以用例不要碰隐藏（将来要测「隐藏 → 托盘唤起」需单独放开这个变量）。
- **单实例只在 release 构建注册**：debug（`pnpm dev` / e2e）不抢锁，所以 `pnpm dev` 能与常驻的 release 实例并存，e2e 也能并行起多个实例。锁的键是 app identifier，细节与验证方法见 `开发经验.md`。
- e2e 用 Playwright + CDP 连真实调试二进制：`pnpm e2e`（默认 **4 worker**；**每个 spec 文件一个实例** —— file 级 scope 由 `e2e-helpers.ts` 的 `_appPool` 自实现，Playwright 本身只有 test / worker 两级）。定位器一律用 **ARIA 语义角色**（`role="application"` 的应用外壳、`aria-label="笔记内容"` 的编辑器 textbox、`拖拽调整顺序` 的每行手柄按钮），不要用 class 选择器。`e2e/<序号>-<功能>-<介词>-<页面>.spec.ts` 的**序号一旦分配不复用、不重排**（现有：01 多行粘贴、02 多行选择与复制、03 置顶、04 回车断行、05 拖拽调序）；测试侧日志写进 `dnote.log`（见 `日志使用说明.md`）。每个实例都**不建托盘**（`launchApp` 注入 `DNOTE_NO_TRAY`），所以用例不要点 `-` 隐藏。
- e2e 用例**必须从 `./e2e-helpers` 导入 `test`**（不是 `@playwright/test`）：那里挂了 auto 的 `testSection` fixture，会在 `dnote.log` 里为每个用例记「用例名 + 结果 + 耗时」两行分节日志，从别处导入就没有这层日志。`expect` 仍从 `@playwright/test` 导入。用例用 `app` / `page` 两个 fixture 拿实例与页面，不要自己 `beforeAll` 起进程。
- e2e 里**动系统剪贴板的动作必须整段包在 `withClipboard()` 内**（含按键与读写两步）：剪贴板是整机唯一资源，并行 worker 会互相串内容，表现为偶发的「内容不对」（见 `开发经验.md`）。实例数据目录需预置时用 `seedLines(app, page, lines)`，不要自己在 spec 里拼路径。
- 构建时打印的 `Removed unused commands from ...` 是 `build.removeUnusedCommands: true` 的正常输出，不是告警。

## 结构速记

- 分层与依赖方向由 `.sentrux/rules.toml` 强制（`sentrux check .`）：Rust `domain(0) ← infra(1) ← commands(2)`（依赖只能从大 order 流向小 order）、Web `bindings(3) ← shared(4) ← features(5) ← app(6)`、`e2e(9)` 可引用任意层；另有两条点名禁令（`bindings.ts` 不得引用 `src/**`、`src/**` 不得引用 `e2e/**`）。**改结构前先看该文件**。
- Rust 分层即目录名，依赖方向 `domain(0) ← infra(1) ← commands(2)`：`commands.rs` + `commands/`（命令）→ `domain.rs` + `domain/`（统一错误）→ `infra.rs` + `infra/`（文本行存储、文件日志）；子模块声明写在同名文件里，**不用 `mod.rs`**；入口 `lib.rs` 的 `run()`。
- 只有两条命令（`commands/notes.rs`）：`load_notes` 读全部行、`save_notes` 整文件重写；**前端那份文本是唯一事实源**，编辑 / 插入 / 删除 / 拖拽全在前端完成，后端只管整文件读写。`commands/main_window.rs` 不是命令，是托盘与单例回调共用的窗口显隐（文件名叫 `main_window` 而非 `window`，是为了避开 sentrux 对 `@tauri-apps/api/window` 的后缀解析误报）。
- 前端 `src/features/notes/`：`logic.ts`（拖拽纯函数 + 单测）、`useNotes.ts`（**整份文本** `content` + 落盘 + `lines` 派生）、`NoteEditor.vue`（**一个 `<textarea>` + 左侧行手柄层**，拖拽编排在这里）；外壳 `src/app/App.vue`（无边框标题条：拖动区 + `＋` 新建 + 置顶图钉 + `-` 隐藏到托盘）。
- **编辑语义一律用浏览器原生的**（回车在光标处断行、退格 / `Delete` 合并相邻两行、`↑↓` 行间移动、`Ctrl+A` / `Ctrl+Z` / 多行选区），**不要自己实现一套**：这正是从「每行一个 `<input>`」换成单个 `<textarea>` 的原因，来龙去脉见 `开发经验.md`。应用只接管两件事：拖拽行排序与落盘。
- 界面偏好（目前只有置顶）存 **localStorage**（在 WebView profile 里），不进 `dnote.txt` —— 那个文件只放笔记内容。
- 存储：`dnote.txt` 一行一条，**行序即顺序**，临时文件 + rename 原子写；行格式约定（每行都以 `\n` 结尾，含最后一行）见 `开发经验.md`，改动编解码必须跑 `pnpm test:rs`。
- `e2e/`：`e2e-helpers.ts`（fixture：每文件一个实例 / CDP 连窗口 / 行读写 / 真实剪贴板 + `withClipboard` 锁 / `seedLines` / 落盘断言）、`e2e-logger.ts`（写 `dnote.log`，含用例分节）、`playwright.config.ts`（workers 4）、`global-setup.ts`（构建内嵌前端的调试二进制并清残留）。
