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
/// `DNOTE_DATA_DIR` 同时是「隔离实例」标识：Rust 侧据此跳过单实例注册，e2e 可与 dev 实例并存。
async function launchApp(workerIndex: number, seq: number): Promise<AppHandle> {
  setWorkerTag(`w${workerIndex}-${seq}`);
  const dataDir = dataDirFor(workerIndex, seq);
  const cdpPort = await freePort();
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DNOTE_DATA_DIR: dataDir,
    // 应用侧日志与测试侧同写 dnote.log：默认 info，按时间顺序读即可还原整轮时序
    DNOTE_LOG: "info",
    // WebView2 profile 按 worker 复用（worker 内文件是顺序跑的，不会同时开两个实例）
    WEBVIEW2_USER_DATA_FOLDER: path.join(TEMP, `wv2-w${workerIndex}`),
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${cdpPort}`,
  };
  const child = spawn(exePath(), [], { cwd: ROOT, env, stdio: "ignore" });
  child.on("error", (e) => e2eLog.error(`[app] spawn 失败：${e.message}`));
  child.on("exit", (code) => e2eLog.info("[app] 进程退出", { code }));

  const browser = await connectAppCdp(cdpPort, child, 10_000);
  const page = await findPageByWindowLabel(browser, "main", 15_000);
  // 就绪判据：应用外壳挂上 + 行列表渲染出第一行（load_notes 是异步的）
  await expect(page.getByRole("application", { name: "dnote 主窗口" })).toBeAttached();
  await expect(rowInput(page, 0)).toBeVisible();
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

/// ---- 行 ----

/// 全部行的输入框（按 DOM 顺序，等价于界面上的上下顺序）
export function rowInputs(page: Page): Locator {
  return page.getByRole("textbox", { name: "笔记内容" });
}

export function rowInput(page: Page, index: number): Locator {
  return rowInputs(page).nth(index);
}

/// 各行的文本（按界面顺序）
export function rowTexts(page: Page): Promise<string[]> {
  return rowInputs(page).evaluateAll((els) => els.map((el) => (el as HTMLInputElement).value));
}

export function rowCount(page: Page): Promise<number> {
  return rowInputs(page).count();
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

/// 从 from 行拖到 to 行（多行选择）。
/// 必须分步移动：一步跳到目标不会产生中间的 pointermove，
/// 而「指针落在别的行上」正是进入行选区模式的触发条件。
export async function dragRows(page: Page, from: number, to: number): Promise<void> {
  const a = await rowInput(page, from).boundingBox();
  const b = await rowInput(page, to).boundingBox();
  if (!a || !b) throw new Error(`取不到第 ${from} / ${to} 行的位置`);
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 });
  await page.mouse.up();
}

/// 当前选中的行（ARIA 选中态，不依赖 class）
export function selectedRows(page: Page): Locator {
  return page.getByRole("option", { selected: true });
}

/// 点进第 index 行后按 Ctrl+V（真实剪贴板粘贴，不走合成事件）。**须在 `withClipboard` 内调用。**
export async function pasteText(page: Page, index: number): Promise<void> {
  await rowInput(page, index).click();
  await page.keyboard.press("Control+V");
}

/// ---- 落盘（dnote.txt）----

/// 按 `infra/store.rs` 的写入规则编码（每行都以 `\n` 结尾，含最后一行）
function encodeLines(lines: string[]): string {
  return lines.map((l) => `${l}\n`).join("");
}

/// 解码 `dnote.txt`：与 `infra/store.rs` 的 `decode_lines` 同一套规则
/// （写入时每行都以 `\n` 结尾；读取时丢弃末尾由终止换行产生的空串，兼容 CRLF）。
function decodeLines(raw: string): string[] {
  const lines = raw.split("\n").map((l) => (l.endsWith("\r") ? l.slice(0, -1) : l));
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

/// 读落盘的行；文件不存在视为空列表
function readPersistedLines(dataDir: string): string[] {
  const file = path.join(dataDir, "dnote.txt");
  if (!fs.existsSync(file)) return [];
  return decodeLines(fs.readFileSync(file, "utf8"));
}

/// 等落盘的行与期望一致（写文件是异步的）
export function expectPersistedLines(dataDir: string, lines: string[]): Promise<void> {
  return expect.poll(() => readPersistedLines(dataDir), { timeout: 3_000 }).toEqual(lines);
}

/// 把 `dnote.txt` 预置成指定内容，并让应用重新读取（reload 会重跑前端初始化）。
/// 同文件的多个用例共用一个实例，靠它把状态复位到已知起点，避免「用 UI 造数据」把
/// 被测功能之外的链路也拉进来。空列表会被应用补成一行空行（见 design.md）。
export async function seedLines(app: AppHandle, page: Page, lines: string[]): Promise<void> {
  fs.mkdirSync(app.dataDir, { recursive: true });
  fs.writeFileSync(path.join(app.dataDir, "dnote.txt"), encodeLines(lines), "utf8");
  await page.reload();
  await expect(rowInput(page, 0)).toHaveValue(lines[0] ?? "");
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
