/**
 * e2e 共用工具：应用实例 fixture（file 级 scope）→ CDP 连接 → 行/剪贴板操作与落盘断言。
 *
 * 复用约定：spec 里只写场景步骤与断言；「怎么起应用、怎么找窗口、怎么读落盘值」这类样板都下沉到这里。
 *
 * 实例生命周期由 fixture 管理（参考 paim 的 `_appPool`）：
 * Playwright 只有 test / worker 两级 fixture scope，**没有 file 级**，而一个 worker 会顺序跑多个
 * spec 文件。这里自己实现 file 级：`_appPool`（worker scope）记住「当前实例属于哪个文件」，
 * 文件切换时先关旧实例（连数据目录一起删）再为该文件起新实例。
 * spec 侧只接收 `app` / `page`，不碰进程管理。
 */
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { execFileSync, execSync, spawn, type ChildProcess } from "node:child_process";
import {
  chromium,
  expect,
  test as base,
  type Browser,
  type Locator,
  type Page,
} from "@playwright/test";
import { e2eLog, setWorkerTag, testLog } from "./e2e-logger";

/// 项目根（e2e/ 的上一级）
const ROOT = path.join(import.meta.dirname, "..");
/// 内嵌前端的页面地址（非 dev 模式的 localhost:1420）
const APP_URL = "http://tauri.localhost";
/// 临时目录（实例数据目录、WebView2 profile、剪贴板锁都放这里，已 gitignore）
const TEMP = path.join(ROOT, "temp");

export interface AppHandle {
  child: ChildProcess;
  browser: Browser;
  /// 主窗口页面（launchApp 时就已就绪）
  page: Page;
  dataDir: string;
  cdpPort: number;
  env: NodeJS.ProcessEnv;
}

/// 调试二进制路径（`tauri build --debug --no-bundle` 产物，globalSetup 已构建）。
/// 共享 target 目录由 CARGO_TARGET_DIR 指定，不得硬编码。
function exePath(): string {
  const targetDir = process.env.CARGO_TARGET_DIR ?? path.join(ROOT, "target");
  return path.join(targetDir, "debug", "dnote.exe");
}

/// 探测一个空闲端口（CDP 每实例独立，并行 worker 互不冲突）
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as net.AddressInfo).port;
      server.close(() => resolve(port));
    });
    server.on("error", reject);
  });
}

/// 轮询连接 CDP，直到应用页面出现；child 用于提前发现进程已崩溃
async function connectAppCdp(
  cdpPort: number,
  child: ChildProcess,
  timeoutMs: number,
): Promise<Browser> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown = new Error("CDP 连接超时");
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`应用进程提前退出 code=${child.exitCode}`);
    try {
      const browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
      if (
        browser
          .contexts()
          .flatMap((c) => c.pages())
          .some((p) => p.url().startsWith(APP_URL))
      ) {
        return browser;
      }
      // 连上了但窗口还没加载出来：放掉这个连接，下一轮重连
      lastErr = new Error("已连接 CDP 但还没有应用页面");
      await browser.close().catch(() => {});
    } catch (e) {
      lastErr = e;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw lastErr;
}

/// 实例数据目录：`temp/e2e-w<worker>-<序号>`。目录名带 worker 号，并行 worker 不会撞车；
/// 序号是本 worker 内的实例序号（每轮从 0 重新计数，残留由 globalSetup 清）。
function dataDirFor(workerIndex: number, seq: number): string {
  return path.join(TEMP, `e2e-w${workerIndex}-${seq}`);
}

/// spawn 一个应用实例、连上 CDP、拿到就绪的主窗口页面。
/// `DNOTE_DATA_DIR` 只重定向数据目录；单实例只在 release 注册，debug（e2e / dev）不抢锁，
/// 所以多个 e2e 实例能并行（dev 之间则由 vite 的 1420 端口拦住，不需要额外机制）。
/// 托盘不建（`DNOTE_NO_TRAY`），但窗口与任务栏图标照旧。
async function launchApp(workerIndex: number, seq: number): Promise<AppHandle> {
  setWorkerTag(`w${workerIndex}-${seq}`);
  const dataDir = dataDirFor(workerIndex, seq);
  const cdpPort = await freePort();
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DNOTE_DATA_DIR: dataDir,
    // 应用侧日志与测试侧同写 dnote.log：默认 info，按时间顺序读即可还原整轮时序
    DNOTE_LOG: "info",
    // 不建托盘：并行 4 worker × 每文件一实例，系统托盘会被一串 DEV 图标塞满，还会盖住常驻实例的图标。
    // 代价：e2e 里不要点 header 的 `-`（隐藏到托盘），没有托盘就再没有唤回入口了。
    DNOTE_NO_TRAY: "1",
    // 窗口几何**跟着数据目录走**（绝对路径）：否则 e2e 与 `pnpm dev` 共用
    // `%APPDATA%\com.dnote.perphyyoung\window-state.dev.json` —— 用例为了次级面板把窗口加宽一栏，
    // 这份几何会被写回、被下一轮恢复，每跑一轮宽一栏（实测撑到 5195px，右边界跑到屏幕外）。
    // 放在实例自己的数据目录里还有个额外好处：每个实例都从 `tauri.conf.json` 的默认几何起跑，
    // 用例不必迁就上一轮留下的窗口大小；目录连同状态文件在实例收尾时一起删掉（见 stopApp）。
    DNOTE_WINDOW_STATE: path.join(dataDir, "window-state.json"),
    // WebView2 profile 按 worker 复用（worker 内文件是顺序跑的，不会同时开两个实例）
    WEBVIEW2_USER_DATA_FOLDER: path.join(TEMP, `wv2-w${workerIndex}`),
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${cdpPort}`,
  };
  // 数据目录先建出来：窗口状态的保存可能早于第一次落笔（它写的就是这个目录里的那个文件）
  fs.mkdirSync(dataDir, { recursive: true });
  const child = spawn(exePath(), [], { cwd: ROOT, env, stdio: "ignore" });
  child.on("error", (e) => e2eLog.error(`[app] spawn 失败：${e.message}`));
  child.on("exit", (code) => e2eLog.info("[app] 进程退出", { code }));

  const browser = await connectAppCdp(cdpPort, child, 10_000);
  const page = await findPageByWindowLabel(browser, "main", 15_000);
  // 就绪判据：应用外壳挂上 + 编辑器渲染出来（load_notes 是异步的，编辑器 v-if="ready"）
  await expect(page.getByRole("application", { name: "dnote 主窗口" })).toBeAttached();
  await expect(editor(page)).toBeVisible();
  e2eLog.info(`[app] 实例就绪 worker=${workerIndex} seq=${seq} dataDir=${dataDir}`);
  return { child, browser, page, dataDir, cdpPort, env };
}

/// 等子进程真正退出：Windows 上 taskkill 返回 ≠ 句柄已释放，紧接着删目录会撞 EBUSY
function waitForExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    timer.unref();
    child.once("exit", () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

async function closeApp(app: AppHandle): Promise<void> {
  const pid = app.child.pid;
  await app.browser.close().catch(() => {});
  if (pid === undefined) return;
  try {
    execSync(`taskkill /PID ${pid}`, { stdio: "ignore" });
  } catch {
    // 已退出
  }
  if (await waitForExit(app.child, 3_000)) return;
  try {
    execSync(`taskkill /F /T /PID ${pid}`, { stdio: "ignore" });
  } catch {
    // 已优雅退出
  }
  await waitForExit(app.child, 10_000);
}

/// 删目录（best-effort，绝不抛）：失败则改名让位，残留由下一轮 globalSetup 清掉。
/// 清理失败是环境噪声，不该把全绿的用例判失败。
function removeDirBestEffort(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  } catch {
    try {
      fs.renameSync(dir, `${dir}-stale-${Date.now()}`);
    } catch (e) {
      e2eLog.warn(`[cleanup] 目录删除与改名均失败：${dir} — ${e}`);
    }
  }
}

async function disposeApp(app: AppHandle): Promise<void> {
  await closeApp(app);
  await waitForExit(app.child, 15_000);
  removeDirBestEffort(app.dataDir);
}

/// 读页面的窗口 label（TAURI 注入的元数据，不发 IPC）
function pageWindowLabel(page: Page): Promise<string> {
  return page
    .evaluate(() => {
      const meta = (
        window as unknown as {
          __TAURI_INTERNALS__?: { metadata?: { currentWindow?: { label?: string } } };
        }
      ).__TAURI_INTERNALS__?.metadata?.currentWindow?.label;
      return meta ?? "";
    })
    .catch(() => "");
}

/// 按窗口 label 轮询查找页面（窗口创建到页面就绪是异步的）
async function findPageByWindowLabel(
  browser: Browser,
  label: string,
  timeoutMs: number,
): Promise<Page> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const candidate of browser.contexts().flatMap((c) => c.pages())) {
      if ((await pageWindowLabel(candidate)) === label) return candidate;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`未找到窗口 label=${label} 的页面`);
}

/// ---- 编辑器 ----
/// 界面上**每块面板一个** textarea：整份笔记就是它的 value，行是其中的 `\n` 分隔（见 useNotes.ts）。
/// 编辑语义（回车拆行、退格 / 删除合并、↑↓ 行间移动、多行选区与 Ctrl+C）全部是浏览器原生的，
/// 所以测试侧也不再需要「行选区」那套定位器。
/// 面板维度：`data-panel` 挂在每块面板的编辑器根上，定位一律从它出发 —— 次级面板展开后
/// 界面上会有两个 textarea / 两个镜像层，不限定面板的定位器会撞上 strict mode。

/** 哪块面板。与 `bindings.ts` 的 `Panel`、`useNotes.ts` 的 `Panel` 是同一个联合类型。 */
export type Panel = "main" | "secondary";

/** 面板根元素（编辑器那一层） */
export function panelRoot(page: Page, panel: Panel = "main"): Locator {
  return page.locator(`[data-panel="${panel}"]`);
}

/// 编辑器本身（aria-label 固定为「笔记内容」）
export function editor(page: Page, panel: Panel = "main"): Locator {
  return panelRoot(page, panel).getByRole("textbox", { name: "笔记内容" });
}

/// 编辑器里的全文（行序即上下顺序）
export function editorText(page: Page, panel: Panel = "main"): Promise<string> {
  return editor(page, panel).inputValue();
}

/// 镜像测层里每个逻辑行的视口矩形（渲染实测，不是前端算的）—— 折行相关用例靠它对齐几何
export function mirrorBoxes(
  page: Page,
  panel: Panel = "main",
): Promise<{ top: number; height: number }[]> {
  return page.evaluate((which) => {
    const mirror = document.querySelector(`[data-panel="${which}"] [data-mirror]`);
    if (!(mirror instanceof HTMLElement)) return [];
    return Array.from(mirror.children, (child) => {
      const rect = child.getBoundingClientRect();
      return { top: rect.top, height: rect.height };
    });
  }, panel);
}

/// 把光标放到第 line 行（0 起）的 column 列。用来构造「行首回车」「多行选择」这类前置状态：
/// 这些用例要的正是**光标位置**，而不只是焦点（原生行为按光标位置决定结果）。
export function caretTo(
  page: Page,
  line: number,
  column = 0,
  panel: Panel = "main",
): Promise<void> {
  return editor(page, panel).evaluate(
    (el, at) => {
      const area = el as HTMLTextAreaElement;
      area.focus();
      let offset = 0;
      for (let i = 0; i < at.line; i += 1) {
        const next = area.value.indexOf("\n", offset);
        offset = next === -1 ? area.value.length : next + 1;
      }
      const pos = Math.min(offset + at.column, area.value.length);
      area.setSelectionRange(pos, pos);
    },
    { line, column },
  );
}

/// 每行的拖拽手柄（按行序，等价于界面上的上下顺序）
export function lineHandles(page: Page, panel: Panel = "main"): Locator {
  return panelRoot(page, panel).getByRole("button", { name: "拖拽调整顺序" });
}

/// 当前行高（px）：读 textarea 的**计算样式**，别在用例里写死。
/// 行高由正文字号按比例派生，而字号用户可改、也会被同一 worker 的其它 spec 留下痕迹
/// （共用一份 WebView profile），写死既会过期又会随机器状态飘。
export async function rowHeight(page: Page, panel: Panel = "main"): Promise<number> {
  return editor(page, panel).evaluate((el) => {
    const value = Number.parseFloat(getComputedStyle(el).lineHeight);
    if (!Number.isFinite(value)) throw new Error("取不到行高：line-height 不是 px 值");
    return value;
  });
}

/// 光标在编辑器里的 offset：断言快捷键把光标落在哪儿时用
export function caretPosition(page: Page): Promise<number> {
  return editor(page).evaluate((el) => (el as HTMLTextAreaElement).selectionStart);
}

/// 把指针停在第 line 行上。行操作按钮只在「指针停在当前行」时显形，断言它出现 / 收起要用它。
/// 行位置直接借手柄的包围盒（手柄就是按行定位的），免得在测试里再抄一份行高常量。
export async function hoverRow(page: Page, line: number): Promise<void> {
  const box = await lineHandles(page).nth(line).boundingBox();
  if (!box) throw new Error(`取不到第 ${line} 行的手柄位置`);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
}

/// 选区起止 offset（没有选区时两者相等）：断言「撤销后不会全选」这类问题用
export function selection(page: Page): Promise<{ start: number; end: number }> {
  return editor(page).evaluate((el) => {
    const area = el as HTMLTextAreaElement;
    return { start: area.selectionStart, end: area.selectionEnd };
  });
}

/// ---- 置顶（localStorage 里的界面偏好）----

/// 与 App.vue 的 PIN_KEY 一致（跨语言无法共享常量）
const PIN_KEY = "dnote:always-on-top";

/// 置顶图钉按钮：aria-label 固定为「置顶」，开/关看 aria-pressed
export function pinButton(page: Page): Locator {
  return page.getByRole("button", { name: "置顶" });
}

/// 读置顶偏好；未存过为 null
export function readPinPreference(page: Page): Promise<string | null> {
  return page.evaluate((key) => localStorage.getItem(key), PIN_KEY);
}

/// 清掉置顶偏好。localStorage 存在 WebView profile 里、跨轮复用，
/// 用例与用例、文件与文件之间必须显式复位（见 paim 的同名经验）。
export function clearPinPreference(page: Page): Promise<void> {
  return page.evaluate((key) => localStorage.removeItem(key), PIN_KEY);
}

/// ---- 剪贴板与粘贴 ----

/// 系统剪贴板是**整机唯一**资源：多 worker 并行时，一个 worker 写剪贴板会串到另一个 worker
/// 正在进行的 Ctrl+V / Ctrl+C 上（表现为偶发的「内容不对」，极难排查）。
/// 因此凡是用到剪贴板的动作，都要包在 `withClipboard` 里串行执行。
/// 锁用 `mkdir` 的原子性实现（目录已存在即被占用）；持锁方异常退出时，20s 后由等待方强制接管。
const CLIPBOARD_LOCK = path.join(TEMP, "clipboard.lock");

export async function withClipboard<T>(fn: () => Promise<T>): Promise<T> {
  fs.mkdirSync(TEMP, { recursive: true });
  const deadline = Date.now() + 30_000;
  let held = false;
  while (!held && Date.now() < deadline) {
    try {
      fs.mkdirSync(CLIPBOARD_LOCK);
      held = true;
    } catch {
      const stat = fs.statSync(CLIPBOARD_LOCK, { throwIfNoEntry: false });
      if (stat && Date.now() - stat.mtimeMs > 20_000) {
        fs.rmSync(CLIPBOARD_LOCK, { recursive: true, force: true });
        continue;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  if (!held) throw new Error("等待剪贴板锁超时（超过 30s）");
  try {
    return await fn();
  } finally {
    fs.rmSync(CLIPBOARD_LOCK, { recursive: true, force: true });
  }
}

/// 把文本写进系统剪贴板。**必须在 `withClipboard` 内调用。**
/// 走 Base64 往返：PowerShell 的 stdout/stdin 编码随控制台代码页变（`clip.exe` 是 OEM、
/// 命令行直传中文同样有编码问题），Base64 全是 ASCII，与代码页无关。
export function setClipboard(text: string): void {
  const b64 = Buffer.from(text, "utf8").toString("base64");
  execFileSync(
    "powershell",
    [
      "-NoProfile",
      "-Command",
      `Set-Clipboard -Value ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${b64}')))`,
    ],
    { stdio: "ignore" },
  );
}

/// 读系统剪贴板的纯文本（同样走 Base64，避免中文被代码页打成乱码）。
/// **必须在 `withClipboard` 内调用。**
export function readClipboard(): string {
  const b64 = execFileSync(
    "powershell",
    [
      "-NoProfile",
      "-Command",
      "[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes([string](Get-Clipboard -Raw)))",
    ],
    { encoding: "utf8" },
  ).trim();
  return b64 ? Buffer.from(b64, "base64").toString("utf8") : "";
}

/// 按住第 from 行的手柄，把它拖到第 to 行。
/// 必须分步移动：一步跳到目标不会产生中间的 pointermove，而指针位置正是落点的依据。
export function dragLine(
  page: Page,
  from: number,
  to: number,
  panel: Panel = "main",
): Promise<void> {
  return dragLineWith(page, from, to, async () => {}, panel);
}

/// 分步拖拽：按下 → 移到第 to 行 → 调用 `during`（此刻**还没松手**，可以断言拖动中的状态）→ 松手。
export async function dragLineWith(
  page: Page,
  from: number,
  to: number,
  during: () => Promise<void>,
  panel: Panel = "main",
): Promise<void> {
  const a = await lineHandles(page, panel).nth(from).boundingBox();
  const b = await lineHandles(page, panel).nth(to).boundingBox();
  if (!a || !b) throw new Error(`取不到第 ${from} / ${to} 行的手柄位置`);
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 });
  await during();
  await page.mouse.up();
}

/// 点进编辑器、把光标落到第 line 行行首，再按 Ctrl+V
/// （真实剪贴板粘贴，不走合成事件）。**须在 `withClipboard` 内调用。**
export async function pasteAt(page: Page, line = 0): Promise<void> {
  await editor(page).click();
  await caretTo(page, line);
  await page.keyboard.press("Control+V");
}

/// ---- 窗口尺寸（从 OS 侧改）----

/// `SetWindowPos` 的 C# 样板：按 pid 找到第一个**可见**顶层窗口，只改尺寸（不动位置与层级）。
/// 用 PowerShell 内联编译，不引第三方依赖（与剪贴板那两段同一套路）。
const WIN_RESIZE_SCRIPT = `
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class WinResize {
  private delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] private static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] private static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
  [StructLayout(LayoutKind.Sequential)] private struct RECT { public int L, T, R, B; }
  public static bool Resize(int pid, int dw, int dh) {
    IntPtr target = IntPtr.Zero;
    EnumWindows(delegate(IntPtr h, IntPtr l) {
      uint p;
      GetWindowThreadProcessId(h, out p);
      if (p == (uint)pid && IsWindowVisible(h)) { target = h; return false; }
      return true;
    }, IntPtr.Zero);
    if (target == IntPtr.Zero) return false;
    RECT r;
    if (!GetWindowRect(target, out r)) return false;
    // SWP_NOMOVE | SWP_NOZORDER：只改尺寸
    return SetWindowPos(target, IntPtr.Zero, 0, 0, r.R - r.L + dw, r.B - r.T + dh, 0x0002 | 0x0004);
  }
}
'@
if (-not [WinResize]::Resize(__PID__, __DW__, __DH__)) { exit 1 }
`;

/**
 * 改主窗口尺寸（OS 侧），**等价于用户拖窗口的缩放边框**。
 *
 * 为什么非得从系统侧来：拖窗口边框是系统的 hit-test，Playwright 只能操作页面内容 —— 而
 * 「拖右缘只改次级那一栏」正是被测行为（`secondaryPanel.ts` 让次级 `flex-1` 吃掉窗口增量）。
 * 副作用：这笔改动会被 `window-state` 记下，但 e2e 的窗口状态是**每个实例自己一份**（见
 * `DNOTE_WINDOW_STATE`），碰不到 dev 那份。
 */
export function resizeWindowBy(pid: number, dw: number, dh: number): void {
  const script = WIN_RESIZE_SCRIPT.replace("__PID__", String(pid))
    .replace("__DW__", String(dw))
    .replace("__DH__", String(dh));
  execFileSync("powershell", ["-NoProfile", "-Command", script], { stdio: "ignore" });
}

/// ---- 落盘（每块面板一个文件）----

/// 面板 → 文件名。与 `infra/store.rs` 的 `MAIN_NOTES_FILE` / `SECONDARY_NOTES_FILE` 一致
/// （跨语言无法共享常量，改了要同步）。
const NOTES_FILES: Record<Panel, string> = {
  main: "dnote.txt",
  secondary: "dnote-secondary.txt",
};

/** 某块面板的笔记文件绝对路径 */
export function notesFile(dataDir: string, panel: Panel = "main"): string {
  return path.join(dataDir, NOTES_FILES[panel]);
}

/// 按 `infra/store.rs` 的写入规则编码（每行都以 `\n` 结尾，含最后一行）
function encodeLines(lines: string[]): string {
  return lines.map((l) => `${l}\n`).join("");
}

/// 解码笔记文件：与 `infra/store.rs` 的 `decode_lines` 同一套规则
/// （写入时每行都以 `\n` 结尾；读取时丢弃末尾由终止换行产生的空串，兼容 CRLF）。
function decodeLines(raw: string): string[] {
  const lines = raw.split("\n").map((l) => (l.endsWith("\r") ? l.slice(0, -1) : l));
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

/// 读某块面板落盘的行；文件不存在视为空列表
export function readPersistedLines(dataDir: string, panel: Panel = "main"): string[] {
  const file = notesFile(dataDir, panel);
  if (!fs.existsSync(file)) return [];
  return decodeLines(fs.readFileSync(file, "utf8"));
}

/// 等落盘的行与期望一致（写文件是异步的）
export function expectPersistedLines(
  dataDir: string,
  lines: string[],
  panel: Panel = "main",
): Promise<void> {
  return expect.poll(() => readPersistedLines(dataDir, panel), { timeout: 3_000 }).toEqual(lines);
}

/// 应用落盘的防抖时长（`useNotes.ts` 的 `SAVE_DEBOUNCE_MS`；跨语言无法共享，改了要同步）
const SAVE_DEBOUNCE_MS = 400;

/**
 * 等某个笔记文件不再被应用改写：连续 `SAVE_DEBOUNCE_MS + 100` 毫秒 mtime 不变才算安静。
 *
 * 为什么必须等：应用的落盘是「防抖 400ms + 异步 IPC」。前一条用例停止编辑后，写入还会**迟到**
 * 一小会儿（`applyEdit` 走 `flushNow`，那一笔 IPC 已经在飞；reload 只会丢掉挂起的定时器，
 * 丢不掉已经发出去的 IPC）。不等它就替它写种子，会被这一笔迟到写入盖掉 ——
 * 前一条用例**在编辑之后失败**时最容易撞上（失败点常常正好在编辑之后）。
 *
 * 文件早就安静时（mtime 很旧）立刻返回，所以只有"上一条用例刚写过"才会真的等。
 */
async function waitForFileQuiet(file: string, timeoutMs = 4_000): Promise<void> {
  const quietMs = SAVE_DEBOUNCE_MS + 100; // 比防抖长一点：任何挂起的写入都有机会落地
  const started = Date.now();
  let last = mtimeOf(file);
  // 已经安静了多久：文件从来没写过（mtime=0）就按「刚看过」算，稳妥等一轮
  let stableSince = last === 0 ? started : Math.min(last, started);
  while (Date.now() - started < timeoutMs) {
    if (Date.now() - stableSince >= quietMs) return;
    await new Promise((resolve) => {
      setTimeout(resolve, 50);
    });
    const now = mtimeOf(file);
    if (now !== last) {
      last = now;
      stableSince = Date.now();
    }
  }
  e2eLog.warn(`[seed] 等 ${path.basename(file)} 安静超时，仍继续（有撞上迟到落盘的风险）`);
}

function mtimeOf(file: string): number {
  return fs.existsSync(file) ? fs.statSync(file).mtimeMs : 0;
}

/// 我们**自己**上次写种子之后的 mtime（**按文件记**：两块面板的种子互不干扰）：
/// 此后文件没被别人动过，就说明没有挂起的应用写入要等
const lastSeedMtime = new Map<string, number>();

/// 把某块面板的笔记文件预置成指定内容，并让应用重新读取（reload 会重跑前端初始化）。
/// 同文件的多个用例共用一个实例，靠它把状态复位到已知起点，避免「用 UI 造数据」把
/// 被测功能之外的链路也拉进来。空文件就是空编辑器，不需要再补行（见 design.md）。
///
/// 写之前先等应用安静（见 `waitForFileQuiet`），写完**界面与文件两边都核对**；
/// 万一那一笔迟到写入还是抢在后面（窄窗口竞争），再写一次 —— 这时应用内存已经与我们一致，必然收敛。
///
/// `panel` 默认主面板：老用例的写法与行为都不变；次级面板要先展开（那个 textarea 才存在）。
export async function seedLines(
  app: AppHandle,
  page: Page,
  lines: string[],
  panel: Panel = "main",
): Promise<void> {
  const file = notesFile(app.dataDir, panel);
  const want = lines.join("\n");
  fs.mkdirSync(app.dataDir, { recursive: true });
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    // 要不要先等它安静：① 应用手上还有没落盘的改动（界面 ≠ 文件，防抖没到点）；
    // ② 文件刚被它写过（可能有一笔 IPC 还在飞）。两者都不是就说明没什么可等的，直接写。
    const dirty =
      readPersistedLines(app.dataDir, panel).join("\n") !==
      (await editor(page, panel).inputValue());
    if (dirty || mtimeOf(file) !== lastSeedMtime.get(file)) await waitForFileQuiet(file);
    fs.writeFileSync(file, encodeLines(lines), "utf8");
    lastSeedMtime.set(file, mtimeOf(file));
    await page.reload();
    try {
      // 界面走 poll：reload 之后前端要异步读一次文件才填上
      await expect(editor(page, panel)).toHaveValue(want, { timeout: 1_500 });
      if (readPersistedLines(app.dataDir, panel).join("\n") === want) return;
      e2eLog.warn(`[seed] 第 ${attempt} 次：界面对了但文件被盖掉，重写再试`);
    } catch {
      e2eLog.warn(`[seed] 第 ${attempt} 次：种子没站稳（多半被应用的迟到落盘盖掉），重写再试`);
    }
  }
  throw new Error(
    `seedLines 两次尝试后仍未把 ${NOTES_FILES[panel]} 置为期望内容：${JSON.stringify(lines)}`,
  );
}

/// ---- fixture ----

/// file 级实例池：Playwright 没有 file 级 scope，这里用「当前实例属于哪个文件」模拟。
interface AppPool {
  acquire(fileKey: string): Promise<AppHandle>;
}

const helpersTest = base.extend<
  { testSection: void; app: AppHandle; page: Page },
  { _appPool: AppPool }
>({
  // 用例分节日志（[TEST] 行）：开始时记 ▶ + 标题，结束时记结果 + 耗时。
  // 与业务日志同阈值（INFO）——默认 debug 下写入；改为 warn 后消失（只记异常信号）。
  // 声明为 auto：全部用例自动生效，spec 侧零改动。
  testSection: [
    async ({}, use, testInfo) => {
      const name = `${path.basename(testInfo.file, ".spec.ts")} › ${testInfo.titlePath.slice(1).join(" › ")}`;
      testLog(testInfo.workerIndex, `▶ ${name}`);
      const startedAt = Date.now();
      await use();
      const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
      if (testInfo.status === "passed") {
        testLog(testInfo.workerIndex, `✓ 通过 ${seconds}s ${name}`);
      } else {
        // 失败原因取首行（超时/断言失败的第一行已足够定位，完整堆栈看 playwright 输出）
        const reason = testInfo.errors[0]?.message?.split("\n")[0] ?? "";
        testLog(
          testInfo.workerIndex,
          `✗ ${testInfo.status} ${seconds}s ${name}${reason ? ` — ${reason}` : ""}`,
        );
      }
    },
    { scope: "test", auto: true },
  ],
  _appPool: [
    async ({}, use, workerInfo) => {
      let seq = 0;
      // 用对象包一层：闭包内改写属性，TS 的控制流分析不会把外面的读取窄化成 null
      const state: { current: { file: string; app: AppHandle } | null } = { current: null };
      await use({
        async acquire(file) {
          if (state.current?.file === file) return state.current.app;
          if (state.current) await disposeApp(state.current.app);
          const app = await launchApp(workerInfo.workerIndex, seq++);
          state.current = { file, app };
          return app;
        },
      });
      // worker 结束（Playwright 保证执行，用例失败/超时也算）：关掉最后一个实例
      if (state.current) await disposeApp(state.current.app);
    },
    { scope: "worker" },
  ],
  app: [
    async ({ _appPool }, use, testInfo) => {
      await use(await _appPool.acquire(testInfo.file));
    },
    // 每个文件的首个用例要等实例 spawn + CDP 就绪（2~4s）：给 fixture 单独 30s 超时，
    // 这段耗时不计入用例自己的 15s，否则首用例容易被启动时间挤爆
    { scope: "test", timeout: 30_000 },
  ],
  // spec 侧直接拿 `page`：就是本文件那个实例的主窗口页面。
  // 用例之间的复位由 spec 自己负责（如 `seedLines` 预置数据 + reload）——
  // dnote 没有弹窗类残留，不做「每个用例自动 reload」，免得把有意的中间状态也抹掉。
  page: [
    async ({ app }, use) => {
      await use(app.page);
    },
    { scope: "test" },
  ],
});

export const test = helpersTest;
