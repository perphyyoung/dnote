# dnote 起步方案（Tauri 2 极简拖拽记事本）

## 1. 定位

- 就是一个**支持拖拽行排序的记事本**：一行一条笔记，垂直排成一片，没有表格、没有表头、没有列、没有卡片。
- 顺序**完全手动**：不做任何自动排序，顺序只由拖拽决定，重启后保持。
- **允许空行**：空行是合法内容，原样存储、原样显示，不做任何自动清理。
- **存储内容 = 界面内容**：后台存的就是这些行本身，没有 id、没有序号、没有时间戳，不存任何界面上看不见的东西。
- **单实例（仅 release 构建）**：正式构建同时只允许一个窗口，二次启动唤起已有窗口；因此也就没有并发写 `dnote.txt` 的问题。debug 构建（`pnpm dev` / e2e）不抢锁，可与常驻的 release 并存（锁的键是 app identifier，dev 与 release 会撞同一把锁，见 `开发经验.md` §4.9）。
- 按《tauri2项目起步指南》（`D:\py-code\pbp\tauri2项目起步指南.md`）起步，依赖按需引入；桌面相关（单实例、窗口状态、托盘、日志）参考 `D:\py-code\cdown`，**版本栈与工程约定尽量与 cdown 保持一致**。

## 2. 技术栈

- 前端：Vue 3 + TS + Vite 6 + Tailwind 3，单视图、无路由。
- 状态：模块级 composable 单例（抄 cdown `useCountdown.ts` 模式），不引 pinia。
- 后端：Tauri 2.12 + tauri-specta rc.25 三件套（命令签名单一事实源）。
- 存储：纯文本文件 `dnote.txt`，一行一条笔记。
- 主题：窗口本身固定深色外观（`theme: "Dark"` + slate-900），笔记区的前景 / 背景可在设置面板里换，另附二十档颜色搭配推荐（含深色与浅色系，见 `design.md`「主题」）。
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

- 一切 id / `sort_order` / 时间戳 / 领域模型结构体 → 存储就是那份文本本身（见 §5）。
- `ConfirmDialog.vue` → 一行文本不值得二次确认：删除就是原生的退格 / `Delete`，直接生效（文本编辑可用 `Ctrl+Z` 撤销）。**例外**：笔记备份的导入是替换语义、必须确认，用**内联的自绘确认框**（仍不引入独立组件，见 `design.md`「删除与确认」）。
- 损坏文件备份与回落（`*.json.bak`、`migrate_*`）→ 纯文本没有「解析失败」这一说。
- `@vuepic/vue-datepicker`、`settings` / `date-picker` 第二窗口。
- 原先还裁掉了 `tauri-plugin-dialog` 与「导入导出」；后来按需求加了**全量笔记备份**（导出 / 导入 zip），这两项随之恢复（决策与理由见本文「已确认的取舍」最后一条、`开发经验.md` §4.17）。
- asset protocol / `protocol-asset` 特性；`vue-router`、pinia、rusqlite、`ColumnWidths` 之类可选持久化字段。

新增（桌面相关，抄 cdown）：

- `tauri-plugin-single-instance`：**必须最先注册**；二次启动唤起已有窗口，顺带免掉并发写 `dnote.txt` 的问题。
- `tauri-plugin-window-state`：窗口尺寸/位置持久化与启动恢复（`with_state_flags(all & !VISIBLE & !DECORATIONS)`，dev/release 状态文件分离）。
- `tauri` 的 `tray-icon` 特性 + 托盘（显示/隐藏、退出）——常驻随手记。
- `tauri-plugin-global-shortcut`：全局热键 `F9` 唤起 / 收回主窗口（见 `commands/hotkey.rs`）。**键位固定不可自定义，但可在设置面板关掉**（缺省开）—— 偏好存前端 localStorage、系统侧只是它的执行结果，启动时幂等应用一次（与开机自启同一口径，理由见 `开发经验.md` §4.6 第 6 条）。
- `tauri-plugin-autostart`：开机自启（Windows 写 `HKCU\...\Run`）—— 偏好**缺省开**、存前端 localStorage，后端只负责落注册表与回读；**dev 构建与无人值守场景不写注册表**（见 `开发经验.md` §4.8）。

## 4. 窗口形态

- 主窗口 label `main`，约 520×480（可缩放，`minWidth: 520 / minHeight: 200`）——像一张小纸条，够长即可。
- **无边框**（`decorations: false`）+ 顶部 `data-tauri-drag-region` 拖动区（需 `core:window:allow-start-dragging`）。
- 顶部只有一条极窄 header：**应用图标 + `dnote` 名称** + 拖动区 + 置顶图钉 + **设置 `⚙`** + 右上角最小化按钮（图标复用 favicon 那份 `public/icon.png`，不另画；设置是标题条下方**内嵌弹出**的面板，不开独立窗口，见 `design.md`）；无边框下没有系统按钮，隐藏/退出都靠这里与托盘（`core:window:allow-hide`）。
- 右上角最小化按钮**用半角减号 `-`**（位置与样式与 cdown 对齐，仅字符换成半角）。
- **默认深色主题**：窗口 `"theme": "Dark"` + `"backgroundColor": [15, 23, 42, 255]`（slate-900，首帧之前也不闪白），CSS 侧 `:root { color-scheme: dark }` 让原生滚动条/光标/选区一并走深色。
  - 坑：这里必须写**大写 `"Dark"`**。`Theme` 的 JSON Schema 是 schemars 自动派生的、用的是变体名（`Light` / `Dark`），而 serde 反序列化是小写化后匹配（`"dark"` 也认）。CLI 先按 schema 校验，写小写会直接报 `"dark" is not valid under any of the schemas listed in the 'anyOf' keyword` 而启动失败。
- **默认置顶**（`alwaysOnTop: true`），图钉按钮可切换（`core:window:allow-set-always-on-top`）；偏好存 localStorage（界面偏好，不进 `dnote.txt`）。
- `skipTaskbar: false`（**占任务栏与 Alt+Tab**）：从别的应用 `Alt+Tab` 能切回来，任务栏按钮可点（最小化 / 还原）；唤回入口 = 任务栏 / 托盘 / 全局热键。曾经是 `true`（工具窗口，与 cdown 对齐），因为任务栏按钮会招来 Show Desktop 把窗口几何写坏（见 `开发经验.md` §1.6）；实测（见决策 23）这条风险当前不成立，故改回。无透明背景、无多窗口。
- **窗口下限按「客户区」理解**：配置里的 `minWidth: 520` / `minHeight: 200` 是客户区的下限，代码里补上那圈不可见缩放边框后再交给系统（`apply_min_size`，见 `开发经验.md` §1.6）—— 配置是唯一事实源，不在别处写死数字。

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

前端持有唯一的一份文本（= `dnote.txt` 的内容本身），是全部数据的唯一事实源；编辑与拖拽**全部在前端本地完成**，改动后防抖 400ms 调一次 `save_notes` 落盘（拖拽结束 / 失焦立即 flush）。整文件重写天然不会出现「部分更新写坏」，原子写保证异常退出最多丢最后一个防抖窗口。

## 6. 交互设计

界面与交互的**硬约定**原文在 `design.md`；这里只记「决定了什么 + 一句话为什么」，不复述规则。

### 6.1 编辑器：一个 `<textarea>`，编辑语义全交给浏览器

- **决定**：不再「每行一个 `<input>`」，整份笔记就是一个 `<textarea>`（长行按右边界**折行**：`pre-wrap` + `break-word`；折行只改排版，逻辑行仍是 `\n` 那一行）。
- **为什么**：记事本该有的语义（光标处断行、合并相邻两行、行间移动、多行选区、撤销）若由 N 个单行输入框模拟，得逐条自研，而且**输入框之间不存在连续选区**，多行选择只能退化成「整行选区」—— 这正是「不符合直觉」的根源。代价与弯路见 `开发经验.md` §3.1。

### 6.2 拖拽调序：Pointer 事件 + 左侧行手柄层（不用 HTML5 DnD）

- **决定**：不用 HTML5 DnD（WebView2 下 `drop` 不触发，paim 已踩实），改用 Pointer 事件 + 手柄层；**拖动期间不改文本**，只画「幽灵行 + 插入线」，松手那一笔走 `applyEdit`（整份替换 → 可 `Ctrl+Z` 撤回，光标一并归位）；落点用 `insertIndexAt`（行优先 + 看方向），不用「按位移换算下标」的旧模型。
- **为什么**：单个 textarea 没有逐行 DOM 节点，做不了 FLIP 让位动画；靠「边拖边重写文本」模拟让位只会跳变，并重置光标与撤销栈。详见 `开发经验.md` §3.11。

### 6.3 选择与复制：全部原生

- **决定**：`copy` / `paste` / `pointerdown` 一概不接管。
- **为什么**：单 textarea 下原生已够用，接管只会引入「行选区」这类中间概念与两套高亮的冲突。

### 6.4 纯函数下沉到 `logic.ts`（vitest 覆盖）

DOM 事件只负责喂参数，全部计算都是无 DOM 依赖的纯函数（编辑语义已由浏览器承担，所以只剩拖拽这两条）：

- `moveItem<T>(list, from, to)` —— 移动元素，越界钳制。
- `insertIndexAt(pointerY, listTop, rowHeight, count, originIndex)` —— 由指针位置换算插入位（行优先 + 看方向；列表之外钳制到两端）。

### 6.5 应用内快捷键：`Ctrl+D` 删行、`Alt+↑/↓` 移行

- **决定**：只用标准 Web API 的 `keydown`（挂在编辑器元素上，不挂 `document`），**不引** `tauri-plugin-global-shortcut`（它只留给「应用失焦也要响应」的全局热键，见 §3）；判定用 `e.code`、输入法组字中放行；实现走 `document.execCommand` 以保住 `Ctrl+Z`。
- **为什么**：键位只有这两个、且只在编辑器内有意义，元素级监听天然随组件装卸；行操作必须可撤销，否则与「删除不确认、靠 undo 兜底」的既有约定冲突。键位与边界见 `design.md`，机制与实测见 `开发经验.md` §3.9 / §3.17。

### 6.6 当前行高亮与行操作

- **决定**：高亮「当前行」（= 光标所在行）；**复制 / 星标 / 行颜色 / 删除**统一放一条跟随光标行的浮条里（`LineActionBar.vue`），编辑器聚焦即显示、失焦即收起；删除复用 `Ctrl+D` 的实现（可撤销、不二次确认），复制只写剪贴板不动文档。行内右侧不再有按钮。
- **为什么**：四个操作的作用对象都是**当前行**（光标所在行），放同一组入口就不存在「指着一行却删了另一行」的误点；行动作搬走后行尾不再被按钮遮挡，代价是不再跟随悬停行。规则见 `design.md`，坑见 `开发经验.md` §3.2。

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
    e2e-helpers.ts              # 起实例 / CDP 连窗口 / 编辑器读写与光标 / 剪贴板 / 落盘断言
    e2e-logger.ts               # 测试侧日志 + 用例分节（写 dnote.log）
    01-paste-multiline-on-main-page.spec.ts
    02-multiline-select-and-copy-on-main-page.spec.ts
    03-always-on-top-on-main-page.spec.ts
    04-enter-key-on-main-page.spec.ts
    05-drag-reorder-on-main-page.spec.ts
    06-editor-shortcuts-on-main-page.spec.ts
    07-line-action-bar-on-main-page.spec.ts
  src/
    bindings.ts                 # 生成物，入库，不手改不格式化
    main.ts  style.css  vite-env.d.ts
    app/App.vue
    utils/logger.ts
    features/notes/
      NoteEditor.vue            # 一个 textarea + 左侧行手柄层（拖拽编排）
      useNotes.ts               # composable：整份文本 + 防抖 save_notes
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

- `commands/main_window.rs` 不是 `#[tauri::command]`（托盘与单例回调共用的窗口显隐 + 尺寸下限 `apply_min_size` / `ensure_min_size`），前端没有对应绑定；`main_window.test.rs` 只覆盖**纯计算**两段（外框下限与尺寸兜底，真窗口那半边靠手工验收），文件名叫 `main_window` 是为了避开 sentrux 后缀解析与 `@tauri-apps/api/window` 的重名（见 `开发经验.md` §4.10）。
- `commands/notes.rs` 只是两条命令的薄包装，真正需要测的行编解码与原子写都在 `infra/store.rs`，测试集中在 `store.test.rs`。
- `commands/autostart.rs` 是唯一的「系统级界面偏好」命令（开机自启，见 §3）：偏好仍在前端 localStorage，它只负责落注册表与回读。它是纯 I/O，没有可抽的纯计算，所以**不写 Rust 单测** —— 判据在 e2e `12`（偏好链路）与手工验收（真注册表，只在 release 做）。

## 8. 关键配置

- `tauri.conf.json`：`productName: "dnote"`、`version: "../package.json"`、`identifier: "com.dnote.perphyyoung"`、`removeUnusedCommands: true`、`bundle.targets: ["nsis"]`、`build.windows.staticVCRuntime: true`；CSP/devCsp 抄 cdown（去掉 `asset:` 相关指令，`devCsp` 放开 `ws://localhost:1420`）。
- `capabilities/default.json`（按实际调用逐条开，`windows: ["main"]`）：`core:window:allow-start-dragging`、`core:window:allow-hide`、`core:window:allow-set-always-on-top`、`core:window:allow-inner-size`、`core:window:allow-scale-factor`、`core:window:allow-set-size`、`core:window:allow-set-min-size`、`core:event:allow-listen`、`core:event:allow-unlisten`（后四条给次级面板开关时加减窗口宽度用）；托盘/单实例/窗口状态全在 Rust 侧操作，无需前端权限。
- 环境变量前缀 `DNOTE_`：`DNOTE_EXPORT_BINDINGS`（导出即退）、`DNOTE_LOG`（覆盖日志级别）、`DNOTE_DATA_DIR`（数据目录重定向，为 e2e 隔离预留）、`DNOTE_NO_TRAY`（存在且非空则不建托盘图标，e2e 的 `launchApp` 会注入；窗口与任务栏图标照旧）、`DNOTE_WINDOW_STATE`（窗口状态文件：只给名字时相对 app_config_dir，绝对路径则直接用；e2e 注入实例数据目录里的那份，避免与 dev 共用 —— 理由见 §10.16）、`DNOTE_BACKUP_PATH`（存在且非空则**跳过笔记备份的文件对话框**、直接读写该路径；e2e 注入实例数据目录里的一个 zip）。保留 `VITE_PORT`、`TAURI_DEV_HOST` 官方变量。
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
4. **前端**：先写 `logic.ts` + `logic.test.ts`（拖拽下标）→ `useNotes.ts`（整份文本 + 落盘）→ `NoteEditor.vue` / `App.vue`。
5. **桌面集成**：单实例（最先注册，仅 release 构建）、窗口状态持久化与恢复、托盘（显示/隐藏、退出；`DNOTE_NO_TRAY` 时不建）、header 的 `-` 隐藏按钮。
6. **质量门**：`pnpm check` 跑通一次 → `sentrux check .` 分层校验通过 → `pnpm dev` 手工验收（重点验拖拽手感、回车断行（行首 / 行中 / 行尾）、退格合并、空行保持、重启后顺序保持）。
7. **e2e**：Playwright + CDP 骨架（`e2e-helpers.ts` / `e2e-logger.ts` / `global-setup.ts` / 配置）——默认 4 worker、**每文件一个实例（file 级 scope）**、用例名与耗时的分节日志、剪贴板等整机唯一资源用 `withClipboard()` 串行；用例覆盖多行粘贴（01）、多行选择 / 复制（02）、置顶（03）、回车断行（04）、拖拽调序（05）、编辑器快捷键（06）、行操作浮条（07）、点最后一行下方（08）、长行折行（09）、折行的视觉反馈（10）、标题条图标与拖动区（11）、设置面板（12）、次级面板（13）、帮助面板（14）、右键菜单（15）、`Win+D` 前后窗口尺寸（16）、行颜色（17）、多行拖拽（18）、带标记复制（19）、星标（20）；`typecheck` 纳入 `e2e/tsconfig.json`。
8. **文档**：`README.md`（使用与上手）、`design.md`（UI/交互硬约定）、`日志使用说明.md`（日志位置、级别开关与 e2e 日志）、`开发经验.md`（踩过的坑）、`AGENTS.md`（给 AI 协作者的规则与环境要点）、`.rules/git提交信息规范.md`（提交格式）。
9. 全局热键 `F9`（可在设置面板关掉）

## 10. 已确认的取舍

1. `identifier` = `com.dnote.perphyyoung`。
2. 窗口形态：**无边框**（自绘 header，与 cdown 一致）。
3. 删除**不做**二次确认，删除即生效 —— 兜底是原生 `Ctrl+Z`：文本编辑之外，结构性编辑（`Ctrl+D` 删行、`Alt+↑/↓` 移行、行内「删除当前行」按钮、拖拽落盘）都走 `applyEdit`，都能撤回；`Ctrl+Y` / `Ctrl+Shift+Z` 重做同样精确（结构性编辑的重放由前端接管，浏览器对长多行的整篇替换重做有缺陷，见 `开发经验.md` §3.9 / §3.10）。
4. **要托盘**；全局热键 `F9`（`tauri-plugin-global-shortcut`）唤起 / 收回主窗口 —— 已实现，键位不可自定义、可在设置面板关掉（缺省开）。
5. **允许空行**，空行不自动删除、原样存储与显示。
6. **做单实例，但只保护 release**：正式构建同时只允许一个窗口、二次启动唤起已有窗口，也就不涉及并发写；debug 构建不抢锁，`pnpm dev` 可与常驻的 release 并存（锁键为 app identifier，两者本会撞锁）。
7. 右上角最小化按钮用**半角减号 `-`**（与 cdown 对齐）。
8. **默认深色主题**，图标用自研的 `scripts/gen-icon.mjs` 生成（内容为「draggable note」）。
9. **dev 用通用「DEV」图标**（`scripts/gen-dev-icon.mjs` 生成）：不绑定本项目、可整段复制到别的项目；托盘与任务栏保持一致，release 才用应用自身图标。**e2e 不建托盘**（`DNOTE_NO_TRAY`），任务栏保留。
10. **编辑器是一个 `<textarea>`**（不是每行一个 `<input>`）：编辑语义全部用浏览器原生 —— 回车在光标处断行（**行首回车即在当前位置插入新行**）、退格 / `Delete` 合并相邻两行、`↑↓` 行间移动、多行选区与复制、`Ctrl+Z` 撤销；应用只接管拖拽行排序与落盘。拖拽手感用「幽灵行 + 插入线 + 松手才换位」补回来（详见 `design.md` 与 `开发经验.md` §3.1 / §3.11）。
11. **默认置顶**（右上角图钉切换，偏好存 localStorage 而不是 `dnote.txt`）。
12. **应用内快捷键**：`Ctrl+D` 删除当前行、`Alt+↑/↓` 上下移动当前行（只按光标行、列保持）、`Esc` 取消当前行（编辑器失焦）；用 Web API 的元素级监听，**不引** global-shortcut 插件（那是给全局热键用的，见 §3）；另外两条**窗口级**键位挂 `document`（编辑器那些只在编辑器内有意义，才必须元素级）：`Esc` 收浮层、`Alt+S` 切次级面板。
13. **行操作**：高亮当前行（光标行，失焦即消失）；**复制 / 星标 / 行颜色 / 删除**统一在跟随光标行的浮条里（编辑器聚焦即显示、失焦即收起，按光标 x / 视觉行定位）；删除与 `Ctrl+D` 同一条实现、可撤销、不二次确认，复制只写剪贴板；行内右侧不再有按钮。
14. **次级面板 = 同窗第二栏，不是第二个窗口**（右侧放不常改的笔记，默认收起）：用侧栏手写两栏要重做焦点 / 置顶 / 坐标 / 跨窗口协议，而同窗直接复用同一个 `NoteEditor` 就白得「所有操作一样」。展开只是把窗口加宽一栏、收起再减回去，两栏同高由 flex 给。
15. **两块面板各存一个文件**（`dnote.txt` / `dnote-secondary.txt`）：用户要的是「存储独立」，共用一对命令加 `panel` 参数即可 —— 两块面板的代码路径同一条，不可能只给一边补了功能；文件名集中在 `infra/store.rs`。
16. **两栏宽度用 flex 分配，不监听 `Resized`**：拖窗口右缘只改次级（展开时主面板固定宽 + 次级 `flex-1`）、拖分界线只改主面板（次级让位、窗口不动）。**两个宽度都落盘**（主宽 = 分界线位置，是"重启后分界线不变"的唯一真值；次级宽 = 下次展开给多宽），并规定权威按时刻切换：启动以主宽为准、从关闭态展开以窗口宽为准。谁反推谁写错过一次，见 `开发经验.md` §4.15。
17. **e2e 的窗口几何与 dev 分离**（`DNOTE_WINDOW_STATE`）：`window-state` 插件按文件名写 app_config_dir，dev 与 e2e 本会共用 `window-state.dev.json` —— 用例为次级面板加宽的那一栏会被写回、下一轮再恢复，**每跑一轮窗口宽一栏**（实测撑到 5195px）。见 `开发经验.md` §4.14。
18. **帮助面板与设置面板同款、且互斥**（标题条 `?` → 内嵌浮层）：内容是静态只读的快捷键清单与「普通笔记没有的」，所以不开独立窗口、不加路由、不新增命令与偏好。两个浮层共用一层遮罩、用一个 `overlay` ref 表示（两个布尔会有"都开着"这个非法态，且三条收起路径要各管一遍）。
19. **多行快捷键作用于整个选区**（`Ctrl+D` 删掉选中的全部行、`Alt+↑/↓` 把整块搬一行）：第一版定的是"只按光标所在行"，改成多行的关键理由是**连按要能用** —— 所以整块移动后选区必须跟着块走（`applyEdit` 的落点因此从单点光标扩成选区）。仍然**不引入"行选区"**：只读一次原生选区换算成行范围，不新增选中状态、也不加行级高亮。
20. **右键菜单是自绘浮层**（编辑器里右键 → 复制 / 删除，多行按选区）：系统菜单早由 `main.ts` 一条全局 `preventDefault` 关掉，而它的样式与坐标由系统定、与"chrome 自带不透明底"的口径冲突，用系统菜单还要新增命令与 IPC。命中规则不自己算几何 —— 借 Chromium"右键点在选区外会挪插入符、在选区内则保留选区"的原生行为，读一次选区就够。层级复用已有的 `z-40`，不新增档。
21. **「清除连续空行」永远作用于整篇**（右键菜单最下方一项）：连续 ≥2 个空行各压成一个、留段内第一行原样 —— 文首 / 文末也留一个，段落间距不至于贴死；**不是**把空行段整个删掉。与上面两项"按选区动态"的差别是有意的：清理排版是文档级动作，只清一半会剩下更奇怪的半截。**「空行」= 内容全是空白字符的行**（纯空格 / 制表符也算 —— 缩进用的空白行不该被当成两段的分界）；没有可压的就**什么都不做**（不写盘、不进撤销栈、光标也不动）。
22. **托盘左键的判定与热键不同源**：托盘左键 = 正看着就收回、否则**一次就唤到前台并聚焦**。判据是「最近一次失焦的时刻」（≤1s，`TRAY_FRONT_GRACE`），**不是焦点本身** —— 点托盘会先夺焦（实测 `Down` / `Up` 两个时刻 `is_focused()` 都已是 `false`），照搬热键那套会让可见窗口永远收不起来；而旧实现"只看可见性"又会让"可见但被别的窗口压住"的那次点击变成收起（用户得连点两次，就是最初报的 bug）。热键 `F9` 仍用焦点判定（按键不夺焦）。两条故意不同源，不合并成一个函数。
23. **主窗口占任务栏与 Alt+Tab**（`skipTaskbar: false`）：用户要「用键盘切回来」，任务栏按钮也就跟着回来了。它同时意味着窗口重新成为 Show Desktop 的目标 —— 这条风险不靠猜：**e2e `16`** 按 `Win+D` 两次，断言整机确实被显示桌面（最小化窗口数变大）、窗口跟着最小化、**再按一次窗口自己回来且几何逐像素一致**，命中即红。实测（本机、debug 构建）：`Win+D` 前后都是 376×459 @26,26。
24. **加了「全量笔记备份」**（设置面板一行：导出 / 导入两块面板的笔记 zip）。三条取舍：① **打包 / 解包放 Rust 侧**（`tauri-plugin-dialog` 的 Rust API + `zip`），前端因此**一条新权限都不用开**，也让 e2e 能靠 `DNOTE_BACKUP_PATH` 绕开原生对话框；② **命令不落盘**：导入只解包并把两份文本返回，前端二次确认后才写（前端那份文本才是唯一事实源）；③ 包内文本用 `store` 同一套逐行编码，保证「导出再导入」与原件等价。**只含笔记**，不含字号 / 颜色 / 热键这些偏好。
25. **加了「行颜色」**（每行下方一道同色细线，向右渐隐）：**入口最终移到光标行浮条**（与复制 / 星标 / 删除并列，见决策 27），行内不再有操作条。**文字本身不能逐行上色**：编辑器是单个 `<textarea>`，换富文本等于推翻原生编辑语义。颜色按行号存 localStorage、跟着删除 / 移动 / 拖拽搬位，**不进笔记文件也不进备份 zip**。
26. **行标记随复制走，但只在应用内**：复制时写 `CF_UNICODETEXT` + 私有格式 `dnote.line-colors.v1`（Rust 直接调 Windows 剪贴板），外部应用只拿文字；内部粘贴要求文本完全一致且是整行替换才套标记。不用 HTML flavor / 零宽字符 / 临时文件：前两者会把格式或脏字符带给外部，第三者会陈旧。格式名是系统级的，dev 与 release 因此互通。
27. **星标与行颜色统一为「行标记」**：两者生命周期完全一致（改字不动行号、行号变了整体搬、结构性编辑要能撤销），所以合成一份 `lineMarks` 状态（颜色 / 星标两个数组 + 一套 `remapMarks` / `spliceMarks` / `shiftMarks`），复制载荷升级为 v2（同时带颜色与星标，v1 旧载荷仍认）。四个行操作（复制 / 星标 / 行颜色 / 删除）放在**跟随光标行的浮条**里（`LineActionBar.vue`），编辑器聚焦即显示、失焦 / 拖拽 / 右键菜单 / 行滚出可视区时收起；浮条水平跟光标 x、垂直贴光标视觉行（优先上方）。星标与拖拽手柄同槽、常显、悬停让位。行内不再有操作条；标题条也不放行操作。窗口最小宽度随早先的标题条入口加到 520（2×），浮条出现后保持不变。
28. **行颜色从十色缩到四档**（无色 / 红 / 绿 / 蓝，直接平铺在浮条上、删掉色板浮层）：十档在实际使用里反而分不清，失去了区分作用；四档点一下就到位，少一层展开。**旧值不迁移**：读取时不在当前色板内的一律按无色算，比维护一张新旧对照表简单。
