# AGENTS.md

- 使用中文回答。
- 未说「执行 / 实施」只给方案，不动代码。
- 使用 pnpm，不用 npm；只用 `package.json` 里的命令，不要用变体。
- 修改代码（含测试）后先跑 `pnpm check`（format → build:rs → gen:bindings → typecheck → build），通过后再按需跑 `pnpm test` / `sentrux check .` / `pnpm e2e`；验证通过才以**围栏代码块**输出一行提交信息，格式遵守 `.rules\git提交信息规范.md`。
- 添加必要的注释，说明**为什么**，而非是什么；修改时不要动不相关的注释。
- 优先修改，而非重写；只碰必须改的部分，不顺手「改进」相邻代码或格式。
- 说「已改 / 已完成」之前，先真落盘并读回确认：没调用编辑工具、或读回与描述不符的，都不算改完（用 `jj st` / 读回文件复核）。
- 不要假设，不要隐藏困惑：存在多种解释、或发现实现与预期不符时，先提问再动手，不要自行改方案。
- 禁止静默失败：优先抛出异常，其次记错误日志，再次控制台输出。
- 及时删除因本次改动而变得未使用的代码；预先存在的死代码只提醒、不擅自删。
- 单测文件与源文件同目录、前缀相同：Rust `foo.rs` ↔ `foo.test.rs`（源文件末尾用 `#[cfg(test)] #[path = "foo.test.rs"] mod tests;` 声明），前端 `foo.ts` ↔ `foo.test.ts`。
- 如果本轮改动涉及的逻辑可以重构，改完提醒用户是否要重构。

## 搜索要求

- 搜索优先用 zg，其次是 rg / Grep，而不是默认的 grep。
- 已知符号 / 字符串 → 精确检索（最快、零维护）；只知道「干什么、不知道叫什么」→ 语义检索，但结果**必须用精确检索复核**后再下结论。
- 代码结构变动后（目录改名、大批文件搬迁）先跑 `zg index`（增量：补新增与变更文件）；只有索引里仍出现已删除 / 旧路径的命中时，才用 `zg index --rebuild`。

## 文档分工（动手前先看：放错地方就会变成重复说明）

- `README.md`（使用者）：这是什么、怎么跑、怎么用 —— 不写为什么与规则细节。
- `design.md`（硬约定）：界面与交互必需怎样表现 —— 不写实现细节与踩坑。
- `dnote起步方案.md`（决策记录）：决定了什么 + 一句话为什么 —— 不复述规则原文与排查过程。
- `开发经验.md`（坑与为什么）：现象 / 根因 / 做法 —— **唯一允许长篇讲理由的地方**，排查先翻它。
- `日志使用说明.md`（日志专题）、`通用语言.md`（术语与命名口径 —— 起名 / 写文案前先看）、`.rules\git提交信息规范.md`（提交格式）、`.sentrux/rules.toml`（分层与依赖方向 —— 改结构前先看）、`D:\py-code\paim\tauri2项目起步指南.md`（跨 tauri 2 项目的配置对齐）。
- 本文件（规则与索引）：每次都遵守、不遵守就出错的事 —— 不写为什么；**同一件事只留一份规则**。

**重复内容的裁决**：规则 → `design.md`；理由 → `开发经验.md`；决策 → `dnote起步方案.md`；用法 → `README.md`；术语 → `通用语言.md`。

## 环境要点

- 命令一律 **PowerShell 7** 写，串联用 `&&`（失败短路）/ `||`（兜底）。
- 命令输出需要截断时**一律只保留最后 100 行**，不得用其它行数。
- **删除是最后手段**，能用更轻的手段就别删：① 先问「这份文件的事实源在哪」——能由脚本 / 源文件一键重建的（`dist/`、`app-icon.png`、`temp/` 残留）才允许删；② 删前用 `search_content` / `search_file` 确认没有别处引用；③ 只是「不想让它入库」的就用 `.gitignore`（文件已被跟踪时补 `jj file untrack`，例：`src-tauri/icons/tray-dev*.png` 预览图），**不要删**；④ 不是本次任务生成的、或用户可能还要看的，先问再删。
- **日志一律清空、不删除**：需要一份干净的日志就 `Clear-Content <log>`（或 `Set-Content -Path <log> -Value $null`），不要 `Remove-Item` —— 日志的价值在于可回溯，条目凭空消失比内容被覆盖更糟。
- `CARGO_TARGET_DIR` 是**机器级环境变量**，指向共享目录 `D:\cargo-shared-target`；所有指向构建产物的脚本必须读该变量、不得硬编码（`scripts/gen-bindings.mjs` 已是此写法）。共享 target 是**全局一把锁**：与其它 tauri 项目不能并行 build，后者只会 `Blocking waiting for file lock`（等待，不是失败）。
- `src/bindings.ts` 是 tauri-specta 运行期导出的生成物：不手改、不入格式化；改了 Rust 命令签名，跑 `pnpm check` 或 `pnpm dev` 即自动复写。
- `tauri.conf.json` 的取值**以 schema 为准**，不要按 serde 的宽松程度写（窗口 `theme` 必须写大写 `"Dark"`，原因见 `开发经验.md`）。
- 主窗口是**工具窗口**（`skipTaskbar: true`），**别改回 `false`**；窗口尺寸只走 `commands/main_window.rs` 的两条 —— `apply_min_size`（把配置的**客户区**下限补上那圈不可见边框后交给系统）与 `ensure_min_size`（启动 / 唤回时兜底），别在别处改尺寸、也不要在运行中挂 `Resized` 监控。理由与踩过的坑见 `开发经验.md`。
- dev 数据在 `<项目根>/dnote-data/`，release 在应用配置目录，两种构建互不共享；`DNOTE_DATA_DIR` 只用于重定向数据目录（e2e 靠它给每个实例分数据）。
- **`DNOTE_WINDOW_STATE`（存在且非空）指定窗口状态文件**：只给名字时相对 app_config_dir，给绝对路径时就用它（`PathBuf::join` 遇绝对路径整体替换）。e2e 注入「实例数据目录里的那个文件」—— 否则它与 `pnpm dev` 共用 `window-state.dev.json`，用例为次级面板加宽的那一栏会被写回并被下一轮恢复，**每跑一轮窗口就宽一栏**（实测撑到 5195px，见 `开发经验.md`）。
- **dev 与 release 的图标不同**（两者常同机并跑）：dev 的托盘与任务栏用通用「红底白字 DEV」图标，release 用应用自身图标。资产与样板都项目无关、可整段复制：`scripts/gen-dev-icon.mjs` + `src-tauri/icons/tray-dev.rgba` + `infra/tray.rs`；改脚本的 `--size` 必须同步 `tray.rs` 的 `DEV_ICON_SIZE`（编译期断言会挡下不一致）。
- **`DNOTE_NO_TRAY`（存在且非空）不建托盘**：e2e 会注入它（并行的每个实例都建托盘会塞满系统托盘）。窗口与任务栏图标照旧；**e2e 用例不要点 header 的 `-` 隐藏** —— 没有托盘就再没有唤回入口。
- **单实例只在 release 构建注册**：debug（`pnpm dev` / e2e）不抢锁，所以 `pnpm dev` 能与常驻的 release 实例并存，e2e 也能并行起多个实例。锁的键是 app identifier，细节与验证方法见 `开发经验.md`。
- e2e 用 Playwright + CDP 连真实调试二进制：`pnpm e2e`（默认 **4 worker**；**每个 spec 文件一个实例**）。**窗口尺寸改不了的地方从 OS 侧改**：`resizeWindowBy(pid, dw, dh)`（user32 的 `SetWindowPos`）—— 拖窗口边框是系统的 hit-test，Playwright 只能操作页面内容（次级面板那两条就是这么验的）。定位器一律用 **ARIA 语义角色**（`role="application"` 的应用外壳、`aria-label="笔记内容"` 的编辑器 textbox、`拖拽调整顺序` 的行手柄按钮），不要用 class 选择器。`e2e/<序号>-<功能>-<介词>-<页面>.spec.ts` 的**序号一旦分配不复用、不重排**（现有：01 多行粘贴、02 多行选择与复制、03 置顶、04 回车断行、05 拖拽调序、06 编辑器快捷键、07 当前行行内操作、08 点最后一行下方、09 长行折行、10 折行的视觉反馈、11 标题条图标与拖动区、12 设置面板、13 次级面板）；测试侧日志写进 `dnote.log`（见 `日志使用说明.md`）。
- **e2e 只跑相关的那几个 spec 文件**（改了哪块跑哪块），**非必要不跑全量**；跑的时候**不要过滤 / 截断输出**，直接看完整结果 —— e2e 的输出本来就不长，截一刀反而会把失败原因（哪个用例、哪一行、Expected/Received）切掉。
- e2e 用例**必须从 `./e2e-helpers` 导入 `test`**（不是 `@playwright/test`）：那里挂了 auto 的 `testSection` fixture，会在 `dnote.log` 里为每个用例记「用例名 + 结果 + 耗时」两行分节日志，从别处导入就没有这层日志。`expect` 仍从 `@playwright/test` 导入。用例用 `app` / `page` 两个 fixture 拿实例与页面，不要自己 `beforeAll` 起进程。
- e2e 里**动系统剪贴板的动作必须整段包在 `withClipboard()` 内**（含按键与读写两步）：剪贴板是整机唯一资源，并行 worker 会互相串内容，表现为偶发的「内容不对」（见 `开发经验.md`）。实例数据目录需预置时用 `seedLines(app, page, lines)`，不要自己在 spec 里拼路径。
- 构建时打印的 `Removed unused commands from ...` 是 `build.removeUnusedCommands: true` 的正常输出，不是告警。

## 结构速记

- 分层与依赖方向由 `.sentrux/rules.toml` 强制（`sentrux check .`）：Rust `domain(0) ← infra(1) ← commands(2)`（依赖只能从大 order 流向小 order）、Web `bindings(3) ← shared(4) ← features(5) ← app(6)`、`e2e(9)` 可引用任意层；另有两条点名禁令（`bindings.ts` 不得引用 `src/**`、`src/**` 不得引用 `e2e/**`）。**改结构前先看该文件**。
- Rust 分层即目录名，依赖方向 `domain(0) ← infra(1) ← commands(2)`：`commands.rs` + `commands/`（命令）→ `domain.rs` + `domain/`（统一错误）→ `infra.rs` + `infra/`（文本行存储、文件日志）；子模块声明写在同名文件里，**不用 `mod.rs`**；入口 `lib.rs` 的 `run()`。
- 应用内快捷键：**编辑器**键位用**元素级** `keydown`（不挂 `document`）；**窗口级**动作（`Esc` 收设置面板、`Alt+S` 切次级面板）挂 `document` —— 焦点不在任何元素上时也要响应；不用 `global-shortcut`（它只服务全局热键 `Ctrl+Alt+N`，见 `commands/hotkey.rs`）；判定用 `e.code`，输入法组字中（`e.isComposing`）一律放行；**结构性编辑（含拖拽落盘）一律走 `applyEdit`**（`execCommand` 全选替换）以保住 `Ctrl+Z` 与光标 —— 直接改 `value` 会丢撤销栈、并把插入符甩到文末；**结构性编辑的重做（`Ctrl+Y` / `Ctrl+Shift+Z`）由前端自己重放那一笔**，不要交回浏览器（Chromium 对「全选 + `insertText`（长且多行）」的重做会丢内容，机制与判据见 `开发经验.md`）；键位若对应可点按钮，`title` 必须带 `(快捷键)`。键位与边界见 `design.md` 快捷键节。
- 只有三条命令：`commands/notes.rs` 的 `load_notes`（读某块面板的全部行）与 `save_notes`（整文件重写某块面板）、`commands/autostart.rs` 的 `set_autostart`（开机自启：dev 构建与无人值守场景**不写注册表**、只按意图回显）；**两块面板共用这对命令，靠 `panel: Panel`（`"main" | "secondary"`）区分** —— 存储是 `infra/store.rs` 的 `NotesStores`（`dnote.txt` / `dnote-secondary.txt`，**两个文件互不牵动**；注册两个 `Store` 会撞 tauri 的按类型托管，所以包一层）；**前端那份文本是唯一事实源**，编辑 / 插入 / 删除 / 拖拽全在前端完成，后端只管整文件读写。`commands/main_window.rs` 不是命令，是托盘与单例回调共用的窗口显隐 + **尺寸下限**（`apply_min_size` 把客户区下限补边框交给系统、`ensure_min_size` 防程序化 `set_size` 恢复出被写坏的几何；两段判定都是纯函数、有单测），文件名叫 `main_window` 而非 `window`，是为了避开 sentrux 对 `@tauri-apps/api/window` 的后缀解析误报。
- 前端 `src/features/notes/`：`logic.ts`（拖拽纯函数 + 单测）、`useNotes.ts`（**每块面板一份**：`useNotes(panel)` 工厂式单例，`content` + 落盘 + `lines` 派生，两块面板互不牵动）、`NoteEditor.vue`（**一个 `<textarea>` + 左侧行手柄层**，拖拽编排在这里；`panel` 是它唯一的面板差异，其余状态都是实例内的 ref）；外壳 `src/app/App.vue`（`main` 是两栏 flex 行：**展开时主面板固定宽 + 次级 `flex-1`**（窗口增量归次级），关闭时主面板 `flex-1` 吃满；次级栏左缘的分界线热区拖主面板宽度；**圆把手在主栏内、圆心锚主栏右边界**（`z-40`，切面板的入口）；无边框标题条：**应用图标 + `dnote` 名称** + 拖动区 + 置顶图钉 + **设置 `⚙`** + `-` 隐藏到托盘 —— 设置是标题条**下方内嵌**弹出的面板，不开独立窗口；图标与 favicon 是同一份 `public/icon.png`；**没有「新建一行」按钮** —— 新行就是回车，见 `design.md`）；`src/features/settings/fontSize.ts`（**笔记正文字号**：localStorage 偏好 + CSS 变量 `--note-font-size`，textarea 与镜像测层必须同源；字号与行高比**一起**决定行高 —— `NoteEditor` 的 `ROW_H` = 字号 × 行高比，两者都由外壳以 prop 传入）、`src/features/settings/lineHeight.ts`（**行高比**：1.0–2.0、步进 0.1、缺省 1.5，同样存 localStorage；面板里排在「字体大小」下一行）、`src/features/settings/background.ts`（**笔记区底色 + 背景透明度**：同样 localStorage；`--note-bg` 始终是不透明十六进制（幽灵行实底、对比度计算用它），整窗真正画的是 `--note-bg-window` = 底色 + 透明度；改了就生效、可重置、不做撤销）、`src/features/settings/foreground.ts`（**笔记正文前景**：`--note-fg` + 三个派生弱化色 `--note-fg-faint` / `--note-fg-weak` / `--note-fg-veil`；正文、镜像、左槽标记（续行箭头 / 手柄）、各种色罩、**标题条图标与按钮**全读它 —— 浅色搭配下这些才不至于消失或发脏，别写死 slate；例外：**压在正文上的行内按钮**（复制 / 删除）用**不透明的 `--note-bg`** 做底 + 图标满色 + 一圈 `ring`，不许用前景稀释色，理由见 `开发经验.md`）、`src/features/settings/themes.ts` + `themes.test.ts`（**颜色搭配推荐**：二十档 `{ name, fg, bg }` + WCAG 对比度纯函数；这个模块**只有数据与纯函数**，不 import 那两个 setter —— 应用动作在外壳里连着调两次，所以单测不用给 localStorage 打桩；单测按对比度盯着每一档）、`src/features/settings/secondaryPanel.ts`（**次级面板 + 两块面板的宽度**：三个 localStorage 偏好 —— 是否展开（缺省关）、**主面板宽度**（= 分界线位置，重启复原靠它，拖分界线松手时写 `commitMainPanelWidth`）、**次级面板宽度**（缺省 320、下限 200，收起时按「窗宽 − 主宽」写回）；启动时以主宽偏好摆分界线、次级 = window-state 的窗口宽 − 主宽，展开时以窗口宽写主宽，窗口下限 = 主宽 + 次级下限；`clampMainWidth` 是分界线拖动用的纯函数）、`src/features/settings/autostart.ts`（**开机自启**：偏好存 localStorage、缺省**开**，实际由 `commands/autostart.rs` 落注册表；**dev 构建与无人值守不写注册表**）。
- **长行按右边界折行**（`pre-wrap` + `break-word`，不再横向滚动）：折行只改排版，**逻辑行仍是 `\n` 那一行**，但「逻辑行 ≠ 视觉行」—— 手柄 / 当前行高亮 / 插入线 / 悬停命中 / 拖拽落点的几何**一律读镜像测层**（`NoteEditor.vue` 的 `[data-mirror]` 与 `measure()`），别再按「下标 × 行高」摆位置；改样式时必须让镜像与 textarea 同框同字体（e2e `09` 有「镜像总高 = textarea 内容高」的护栏盯着）。
- **编辑语义用浏览器原生的，不要自己实现一套**（回车在光标处断行、退格 / `Delete` 合并相邻两行、`↑↓` 行间移动、`Ctrl+A` / `Ctrl+Z` / 多行选区）；应用只接管两件事：拖拽行排序与落盘。理由见 `开发经验.md`。唯一的例外是**最后一行下方那片容器空白区**（浏览器不管那儿，点击只会让编辑器失焦、打字全丢）：由 `onScrollerDown` 兜住，点击后光标落文末。
- 界面偏好**全部**存 **localStorage**（在 WebView profile 里）：置顶、笔记正文字号、行高比、前景颜色、背景颜色、背景透明度、开机自启、次级面板是否展开 —— 都不进笔记文件（那两个文件只放笔记内容）。「颜色搭配推荐」不是偏好：它只批量写前景与背景。
- 存储：**每块面板一个文件**（`dnote.txt` / `dnote-secondary.txt`）一行一条，**行序即顺序**，临时文件 + rename 原子写；行格式约定（每行都以 `\n` 结尾，含最后一行）见 `开发经验.md`，改动编解码必须跑 `pnpm test:rs`。
- `e2e/`：`e2e-helpers.ts`（fixture：每文件一个实例 / CDP 连窗口 / 行读写 / 真实剪贴板 + `withClipboard` 锁 / `seedLines` / 落盘断言；**面板维度**：`editor` / `mirrorBoxes` / `lineHandles` / `dragLine` / `seedLines` 等都带 `panel = "main"` 参数，靠每块面板编辑器根上的 `data-panel` 定位 —— 次级面板展开后界面上有两个 textarea / 两个镜像层，不限定面板的定位器会撞 strict mode）、`e2e-logger.ts`（写 `dnote.log`，含用例分节）、`playwright.config.ts`（workers 4）、`global-setup.ts`（构建内嵌前端的调试二进制并清残留）。
