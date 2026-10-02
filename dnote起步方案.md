# dnote 起步方案（Tauri 2 极简拖拽记事本）

## 1. 定位

- 就是一个**支持拖拽行排序的记事本**：一行一条笔记，垂直排成一片，没有表格、没有表头、没有列、没有卡片。
- 顺序**完全手动**：不做任何自动排序，顺序只由拖拽决定，重启后保持。
- **允许空行**：空行是合法内容，原样存储、原样显示，不做任何自动清理。
- **存储内容 = 界面内容**：后台存的就是这些行本身，没有 id、没有序号、没有时间戳，不存任何界面上看不见的东西。
- **单实例（仅 release 构建）**：正式构建同时只允许一个窗口，二次启动唤起已有窗口；因此也就没有并发写 `dnote.txt` 的问题。debug 构建（`pnpm dev` / e2e）不抢锁，可与常驻的 release 并存（锁的键是 app identifier，dev 与 release 会撞同一把锁，见 `开发经验.md`）。
- 按《tauri2项目起步指南》（`D:\py-code\paim\tauri2项目起步指南.md`）起步，依赖按需引入；桌面相关（单实例、窗口状态、托盘、日志）参考 `D:\py-code\cdown`，**版本栈与工程约定尽量与 cdown 保持一致**。

## 2. 技术栈

- 前端：Vue 3 + TS + Vite 6 + Tailwind 3，单视图、无路由。
- 状态：模块级 composable 单例（抄 cdown `useCountdown.ts` 模式），不引 pinia。
- 后端：Tauri 2.12 + tauri-specta rc.25 三件套（命令签名单一事实源）。
- 存储：纯文本文件 `dnote.txt`，一行一条笔记。
- 主题：默认深色（窗口 `theme: "Dark"` + slate-900 底色）。
- 测试：vitest 测拖拽下标计算与粘贴拆行；cargo test 测文本行读写；e2e 用 Playwright 经 CDP 连真实调试二进制，覆盖跨端链路。

## 3. 依赖取舍（相对 cdown，按需裁剪）

保留（与 cdown / 指南一致）：

- pnpm pin（`packageManager: pnpm@12.4.2`）、版本单一事实源（`tauri.conf.json` 的 `version: "../package.json"`）。
- 根 `Cargo.toml` workspace + `[profile.release]` 体积优化段；共享 `CARGO_TARGET_DIR=D:\cargo-shared-target`，脚本一律读环境变量。
- tauri 版本栈：Rust `tauri 2.12.0` / `tauri-build 2.7.0`，npm `@tauri-apps/api`、`@tauri-apps/cli` 均 2.12.0。
- Rust 分层 `commands/domain/infra`（同名 `.rs` + 同名目录，**不用 `mod.rs`**，子模块声明写在同名文件里）；测试平铺 `<源文件>.test.rs`（源文件末尾 `#[cfg(test)] #[path]` 声明）。
- `specta_builder()` + 两条导出路径（`DNOTE_EXPORT_BINDINGS` 导出即退 / debug 启动自动导出）+ `scripts/gen-bindings.mjs`。
- `build.removeUnusedCommands: true` + capabilities 精确清单；生产严格 CSP + `devCsp` 放宽。
- 自研文件日志 `infra/logging.rs`（`dnote.log` + `dnote-config.toml` 分级 + `DNOTE_LOG` 环境变量），`tauri-plugin-log` 仅 debug 终端输出。
- oxfmt + cargo fmt、vitest、`pnpm check` 质量门（format → build:rs → gen:bindings → typecheck → build）。

裁掉（相比 cdown）：

- 一切 id / `sort_order` / 时间戳 / 领域模型结构体 → 存储就是行数组（见 §5）。
- `ConfirmDialog.vue` → 一行文本不值得二次确认，删除走行内「×」直接生效（后续靠 undo/redo 兜底，见 §9）。
- 损坏文件备份与回落（`*.json.bak`、`migrate_*`）→ 纯文本没有「解析失败」这一说。
- `tauri-plugin-dialog`、导入导出、`@vuepic/vue-datepicker`、`settings` / `date-picker` 第二窗口、`tauri-plugin-autostart`。
- asset protocol / `protocol-asset` 特性；`vue-router`、pinia、rusqlite、`ColumnWidths` 之类可选持久化字段。

新增（桌面相关，抄 cdown）：

- `tauri-plugin-single-instance`：**必须最先注册**；二次启动唤起已有窗口，顺带免掉并发写 `dnote.txt` 的问题。
- `tauri-plugin-window-state`：窗口尺寸/位置持久化与启动恢复（`with_state_flags(all & !VISIBLE & !DECORATIONS)`，dev/release 状态文件分离）。
- `tauri` 的 `tray-icon` 特性 + 托盘（显示/隐藏、退出）——常驻随手记。
- `tauri-plugin-global-shortcut`：`Ctrl+Alt+N` 唤起——**二期再加**，一期不引。

## 4. 窗口形态

- 主窗口 label `main`，约 360×480（可缩放，`minWidth: 260 / minHeight: 200`）——像一张小纸条，够长即可。
- **无边框**（`decorations: false`）+ 顶部 `data-tauri-drag-region` 拖动区（需 `core:window:allow-start-dragging`）。
- 顶部只有一条极窄 header：拖动区 + 「＋」新建 + 置顶图钉 + 右上角最小化按钮；无边框下没有系统按钮，隐藏/退出都靠这里与托盘（`core:window:allow-hide`）。
- 右上角最小化按钮**用半角减号 `-`**（位置与样式与 cdown 对齐，仅字符换成半角）。
- **默认深色主题**：窗口 `"theme": "Dark"` + `"backgroundColor": [15, 23, 42, 255]`（slate-900，首帧之前也不闪白），CSS 侧 `:root { color-scheme: dark }` 让原生滚动条/光标/选区一并走深色。
  - 坑：这里必须写**大写 `"Dark"`**。`Theme` 的 JSON Schema 是 schemars 自动派生的、用的是变体名（`Light` / `Dark`），而 serde 反序列化是小写化后匹配（`"dark"` 也认）。CLI 先按 schema 校验，写小写会直接报 `"dark" is not valid under any of the schemas listed in the 'anyOf' keyword` 而启动失败。
- **默认置顶**（`alwaysOnTop: true`），图钉按钮可切换（`core:window:allow-set-always-on-top`）；偏好存 localStorage（界面偏好，不进 `dnote.txt`）。
- `skipTaskbar: false`；无透明背景、无多窗口。

## 5. 存储与命令

**存储**：`dnote.txt`，一行一条笔记。

- 行序即上下顺序；文件内容与界面逐行一致，可以直接用记事本打开核对。
- **行格式约定（保证空行能原样往返）**：写入时**每一行都以 `\n` 结尾（含最后一行）**；读取时按 `\n` 切分并丢弃末尾由终止换行产生的空串。这样 `["a", ""]` ↔ `"a\n\n"`、`[]` ↔ `""` 都能精确往返，末尾空行不会丢。
- 写：先写 `dnote.txt.tmp` 再 `fs::rename` 覆盖（原子写，Windows 走 MOVEFILE_REPLACE_EXISTING）。
- 数据目录三级优先：`DNOTE_DATA_DIR`（非空才生效）> debug `<项目根>/dnote-data` > release `app.path().app_config_dir()`。
- release 单实例运行，不存在多个实例并发写同一份 `dnote.txt` 的情况；dev 不防多开（数据是草稿，要隔离就给各实例带上 `DNOTE_DATA_DIR`）。

**命令只有两条**：

- `load_notes() -> Vec<String>` —— 返回全部行，前端不再排序。
- `save_notes(lines: Vec<String>)` —— 整文件重写。

前端持有唯一的行数组，是全部数据的唯一事实源；编辑、插入、删除、拖拽**全部在前端本地完成**，改动后防抖 400ms 调一次 `save_notes` 落盘（失焦立即 flush）。整文件重写天然不会出现「部分更新写坏」，原子写保证异常退出最多丢最后一个防抖窗口。

## 6. 交互设计

### 6.1 行的编辑规则

- **点击行内任意位置**即可编辑：每行就是一个无边框 `<input>`，没有展示态/编辑态切换，没有卡片容器。
- `Enter` → 在本行下方插入一条空行并聚焦。
- 空行上按 `Backspace`，或点行尾悬停出现的「×」→ 直接删除该行（不弹确认）并聚焦上一行。
- **多行粘贴必须拆行**：`<input>` 的默认粘贴会把换行压平（换行变空格），所以自己接 `paste` 事件，用 `clipboardData` 的原始文本按 `CRLF|CR|LF` 拆行 —— 首行接光标前原文、末行接光标后原文、中间行落到下方；只有不含换行时不接管。纯函数 `pasteLines` 放 `logic.ts` 由 vitest 覆盖。
- **空行不作任何自动处理**：失焦、切窗口、重启都不会清理空行；仅当整个列表为空（文件中一行都没有）时自动补一条空行，保证永远有地方输入。

### 6.2 拖拽调序：Pointer 事件（不用 HTML5 DnD）

**WebView2 下原生 HTML5 `dragstart/drop` 不触发**（paim 已踩实，见 `useTagDragToCard.ts` 注释），统一用 Pointer 事件：

- 行首 hover 时出现一个极小的拖拽点（`⠿`）承载 `pointerdown`；`setPointerCapture(pointerId)` 抓取，移动超阈值（5px）才进入拖拽态（避免与「点击进输入框」冲突）。
- 拖拽中：被拖行 `transform: translateY(dy)` 跟手 + `z-index`/阴影抬升；其余行按目标下标做 `transition` 让位（不动 DOM，只改 class）。
- `pointerup` / `pointercancel`：算出最终下标 → 本地重排（乐观更新）→ 防抖 `save_notes`。
- 拖拽期间 `user-select: none`；拖拽点加 `touch-action: none`。

### 6.3 多行选择与多行复制

单行内的拖选与 Ctrl+C 保持浏览器原生行为；**多行**选择自己实现（每行是独立的 `<input>`，浏览器不可能跨元素选中文字）：

- 按下时只记锚点行；**指针落到别的行**才进入行选区（还在同一行内就什么都不做，交给原生文字选择）；进入时 `blur()` 主动结束输入框里的原生选中高亮，避免两套高亮并存。
- 选区是闭区间 `[start, end]`，反向拖同一结果；选中行用 `aria-selected` 表达（列表是 `listbox`、每行是 `option`），e2e 据此断言。
- 行选区内 Ctrl+C 自己接管 `copy` 事件写剪贴板（各行用 `\n` 连接），**没有选区时不接管**，单行复制仍走原生；点任意行 / `Esc` / 任何结构变动都会清掉选区。
- 多行粘贴与多行复制共用同一套行模型，因此复制出来的文本必须能原样粘回去。

### 6.4 纯函数下沉到 `logic.ts`（vitest 覆盖）

DOM 事件只负责喂参数，全部计算都是无 DOM 依赖的纯函数：

- `moveItem<T>(list, from, to)` —— 移动元素，越界钳制。
- `dropIndex(pointerY, startY, rowHeight, originIndex, count)` —— 由位移量换算目标行下标（基准固定在按下那一刻，实时重排才可逆）。
- `pasteLines(text, before, after)` —— 多行粘贴拆行；不含换行返回 `null`（不接管）。
- `rangeLines(lines, start, end)` / `selectionText(lines, start, end)` —— 行选区取行与拼文本（`\n` 连接）。

## 7. 目录结构

```dir
dnote/
  package.json  pnpm-workspace.yaml  Cargo.toml        # workspace 根 + release profile
  index.html  vite.config.ts  vitest.config.ts  tsconfig.json
  tailwind.config.js  postcss.config.js  .oxfmtrc.json
  scripts/gen-bindings.mjs  scripts/gen-icon.mjs  scripts/gen-dev-icon.mjs
  README.md  design.md  日志使用说明.md  开发经验.md  通用语言.md  AGENTS.md
  .rules/git提交信息规范.md  .sentrux/rules.toml
  e2e/
    playwright.config.ts  global-setup.ts  tsconfig.json
    e2e-helpers.ts              # 起实例 / CDP 连窗口 / 行读写 / 剪贴板 / 落盘断言
    e2e-logger.ts               # 测试侧日志 + 用例分节（写 dnote.log）
    01-paste-multiline-on-main-page.spec.ts
    02-multiline-select-and-copy-on-main-page.spec.ts
    03-always-on-top-on-main-page.spec.ts
  src/
    bindings.ts                 # 生成物，入库，不手改不格式化
    main.ts  style.css  vite-env.d.ts
    app/App.vue
    utils/logger.ts
    features/notes/
      NotesPanel.vue            # 行列表：拖拽编排 + 新建
      NoteLine.vue              # 单行：input + 拖拽点 + 删除「×」
      useNotes.ts               # composable：单例行数组 + 防抖 save_notes
      logic.ts  logic.test.ts   # 纯函数：moveItem / dropIndex
  src-tauri/
    tauri.conf.json  capabilities/default.json  icons/
    .gitignore                  # /target/ 与 /gen/schemas
    src/                        # 同名 .rs + 同名目录，不用 mod.rs
      lib.rs  main.rs
      commands.rs  commands/{notes.rs, main_window.rs}
      domain.rs    domain/error.rs
      infra.rs     infra/{store.rs, store.test.rs, logging.rs, tray.rs}
```

Rust 依赖方向（同 cdown）：`commands(2) → infra(1) → domain(0)`；`domain` 里只剩统一的命令错误类型。

- `commands/main_window.rs` 不是 `#[tauri::command]`（托盘与单例回调共用的窗口显隐），因此没有对应的 `.test.rs`；文件名叫 `main_window` 是为了避开 sentrux 后缀解析与 `@tauri-apps/api/window` 的重名（见 `开发经验.md`）。
- `commands/notes.rs` 只是两条命令的薄包装，真正需要测的行编解码与原子写都在 `infra/store.rs`，测试集中在 `store.test.rs`。

## 8. 关键配置

- `tauri.conf.json`：`productName: "dnote"`、`version: "../package.json"`、`identifier: "com.dnote.perphyyoung"`、`removeUnusedCommands: true`、`bundle.targets: ["nsis"]`、`build.windows.staticVCRuntime: true`；CSP/devCsp 抄 cdown（去掉 `asset:` 相关指令，`devCsp` 放开 `ws://localhost:1420`）。
- `capabilities/default.json`（按实际调用逐条开，`windows: ["main"]`）：`core:window:allow-start-dragging`、`core:window:allow-hide`、`core:window:allow-set-always-on-top`、`core:event:allow-listen`、`core:event:allow-unlisten`；托盘/单实例/窗口状态全在 Rust 侧操作，无需前端权限。
- 环境变量前缀 `DNOTE_`：`DNOTE_EXPORT_BINDINGS`（导出即退）、`DNOTE_LOG`（覆盖日志级别）、`DNOTE_DATA_DIR`（数据目录重定向，为 e2e 隔离预留）、`DNOTE_NO_TRAY`（存在且非空则不建托盘图标，e2e 的 `launchApp` 会注入；窗口与任务栏图标照旧）。保留 `VITE_PORT`、`TAURI_DEV_HOST` 官方变量。
- vite：端口 `1420` + `strictPort`、`@` → `src`、`define.__APP_VERSION__`、`server.watch.ignored` 用**白名单**（仅 `index.html` + `src/` + `public/`，抄 cdown/paim）。
- `.gitignore`：根放 `dnote-data*/`、`temp/`、`tmp-*`、`target/`、`node_modules/`、`dist/`、`*.log`；`src-tauri/.gitignore` 放 `/target/`、`/gen/schemas`。`Cargo.lock` 与 `src/bindings.ts` **入库**。
- 图标：`scripts/gen-icon.mjs` 自研生成（风格抄 cdown 同名脚本）——1024×1024 深色圆角方块 + 三行笔记 + 一行被拖起的红行与 2×3 把手，内容就是「draggable note」；用法 `node scripts/gen-icon.mjs && pnpm tauri icon app-icon.png`，产物 `icon.png` 同时拷成 `public/icon.png` 作 favicon。`app-icon.png` 是可再生的中间产物，不入库。
- **dev 图标**：`scripts/gen-dev-icon.mjs` 生成通用的「红底圆角 + 白色大写 `DEV`」图标，dev 的**托盘与任务栏共用**它（e2e 不建托盘，见 §8 的 `DNOTE_NO_TRAY`），release 用应用自身图标 —— dev 与 release 常同机并跑，图标不同才能一眼认出谁是谁。两点刻意设计：
  - **与项目无关、零依赖、可整段复制**：脚本不引用项目任何东西（`--size` / `--text` / `--fg` / `--bg` 全可覆盖），配套 Rust 样板 `infra/tray.rs` 与产物 `src-tauri/icons/tray-dev.rgba` 一起拷到别的 Tauri 项目即可用。
  - **裸 RGBA + `Image::new`，不新增任何 Cargo feature**：产物就是 `Image::new(rgba, w, h)` 要的格式（官方对 `.ico` 也是构建期解码成裸 RGBA，见 `CachedIcon`），因此不需要 `image-png` / `image-ico` 这类运行期解码器。`tray.rs` 里用 `const _: () = assert!(...)` 钉住「字节数 = 边长²×4」，脚本改了尺寸而 Rust 没跟就会编译失败。
  - 尺寸 128×128（托盘实际只按 16–24px 渲染）；脚本额外写两张不入库的预览图（`.png` 与 `@16.png`），后者按 16px 直接渲染，用来预判任务栏里的实际观感。

## 9. 实施步骤

1. **脚手架**：`package.json`（pnpm pin + scripts 照 cdown 改项目名）、`pnpm-workspace.yaml`、根 `Cargo.toml`、vite/tailwind/postcss/oxfmt/vitest/tsconfig 配置。
2. **Rust 骨架**：`lib.rs`（`specta_builder()` + 两条导出路径 + 单实例注册（仅 release 构建））、`infra/store.rs`（文本行读 + 原子写 + 数据目录）、`infra/logging.rs`（文件日志）、`commands/notes.rs`（2 条命令），配 `store.test.rs`（多行往返、空行与末尾空行往返、`\r\n` 兼容、空文件）。
3. **配置**：`tauri.conf.json`（含深色主题与窗口底色）+ `capabilities/default.json` + 图标（`node scripts/gen-icon.mjs && pnpm tauri icon app-icon.png`）+ dev 图标（`node scripts/gen-dev-icon.mjs`）。
4. **前端**：先写 `logic.ts` + `logic.test.ts`（拖拽下标）→ `useNotes.ts` → `NoteLine.vue` / `NotesPanel.vue` / `App.vue`。
5. **桌面集成**：单实例（最先注册，仅 release 构建）、窗口状态持久化与恢复、托盘（显示/隐藏、退出；`DNOTE_NO_TRAY` 时不建）、header 的 `-` 隐藏按钮。
6. **质量门**：`pnpm check` 跑通一次 → `sentrux check .` 分层校验通过 → `pnpm dev` 手工验收（重点验拖拽手感、Enter/Backspace 行操作、空行保持、重启后顺序保持）。
7. **e2e**：Playwright + CDP 骨架（`e2e-helpers.ts` / `e2e-logger.ts` / `global-setup.ts` / 配置）——默认 4 worker、**每文件一个实例（file 级 scope）**、用例名与耗时的分节日志、剪贴板等整机唯一资源用 `withClipboard()` 串行；用例覆盖多行粘贴（01）与多行选择/复制（02）；`typecheck` 纳入 `e2e/tsconfig.json`。
8. **文档**：`README.md`（使用与上手）、`design.md`（UI/交互硬约定）、`日志使用说明.md`（日志位置、级别开关与 e2e 日志）、`开发经验.md`（踩过的坑）、`AGENTS.md`（给 AI 协作者的规则与环境要点）、`.rules/git提交信息规范.md`（提交格式）。
9. **二期（可选）**：undo/redo（承接「删除不确认」）、全局热键 `Ctrl+Alt+N`、更多 e2e 用例。

## 10. 已确认的取舍

1. `identifier` = `com.dnote.perphyyoung`。
2. 窗口形态：**无边框**（自绘 header，与 cdown 一致）。
3. 删除**不做**二次确认，删除即生效；后续加 undo/redo 兜底。
4. **要托盘**；全局热键**后期再加**（`tauri-plugin-global-shortcut`，`Ctrl+Alt+N`），一期不引。
5. **允许空行**，空行不自动删除、原样存储与显示。
6. **做单实例，但只保护 release**：正式构建同时只允许一个窗口、二次启动唤起已有窗口，也就不涉及并发写；debug 构建不抢锁，`pnpm dev` 可与常驻的 release 并存（锁键为 app identifier，两者本会撞锁）。
7. 右上角最小化按钮用**半角减号 `-`**（与 cdown 对齐）。
8. **默认深色主题**，图标用自研的 `scripts/gen-icon.mjs` 生成（内容为「draggable note」）。
9. **dev 用通用「DEV」图标**（`scripts/gen-dev-icon.mjs` 生成）：不绑定本项目、可整段复制到别的项目；托盘与任务栏保持一致，release 才用应用自身图标。**e2e 不建托盘**（`DNOTE_NO_TRAY`），任务栏保留。
9. **多行粘贴必须拆行**（`<input>` 默认会把换行压平，必须自己接管 `paste`）。
10. **多行选择与多行复制**（单行内保持原生选择；多行自己实现行选区，Ctrl+C 写 `\n` 连接的多行文本）。
11. **默认置顶**（右上角图钉切换，偏好存 localStorage 而不是 `dnote.txt`）。
