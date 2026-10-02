/**
 * e2e 共用工具：启动调试二进制 → CDP 连接 → 取主窗口页面 → 行/剪贴板操作与落盘断言。
 *
 * 约定：spec 里只写场景步骤与断言；「怎么起应用、怎么找窗口、怎么读落盘值」这类样板都下沉到这里。
 * 实例生命周期由 spec 的 beforeAll/afterAll 直接管理（暂不引入 fixture）。
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

export interface AppHandle {
  child: ChildProcess;
  browser: Browser;
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

/// 序号对应的数据目录（与 launchApp 内部一致，供 spec 启动前预置 dnote.txt）
export function dataDirFor(seq: number): string {
  return path.join(ROOT, "temp", `e2e-${seq}`);
}

/// spawn 一个应用实例并连上 CDP。数据目录隔离到 temp/e2e-<序号>（已 gitignore）。
/// `DNOTE_DATA_DIR` 同时是「隔离实例」标识：Rust 侧据此跳过单实例注册，e2e 可与 dev 实例并存。
export async function launchApp(seq = 0): Promise<AppHandle> {
  const dataDir = dataDirFor(seq);
  const cdpPort = await freePort();
  // 测试侧日志的实例标识（与 dnote.log 里应用侧的行交错时用于区分归属）
  setWorkerTag(`w${process.env.TEST_WORKER_INDEX ?? "0"}-${seq + 1}`);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DNOTE_DATA_DIR: dataDir,
    // 应用侧日志与测试侧同写 dnote.log：默认 info，按时间顺序读即可还原整轮时序
    DNOTE_LOG: "info",
    WEBVIEW2_USER_DATA_FOLDER: path.join(ROOT, "temp", "wv2-e2e"),
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${cdpPort}`,
  };
  const child = spawn(exePath(), [], { cwd: ROOT, env, stdio: "ignore" });
  child.on("error", (e) => e2eLog.error(`[app] spawn 失败：${e.message}`));
  child.on("exit", (code) => e2eLog.info("[app] 进程退出", { code }));
  const browser = await connectAppCdp(cdpPort, child, 10_000);
  return { child, browser, dataDir, cdpPort, env };
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

export async function disposeApp(app: AppHandle): Promise<void> {
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
export async function findPageByWindowLabel(
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

/// 主窗口页面：应用外壳挂上 + 行列表渲染出第一行（load_notes 是异步的）
export async function mainPage(app: AppHandle): Promise<Page> {
  const page = await findPageByWindowLabel(app.browser, "main", 15_000);
  await expect(page.getByRole("application", { name: "dnote 主窗口" })).toBeAttached();
  await expect(rowInput(page, 0)).toBeVisible();
  return page;
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
  return rowInputs(page).evaluateAll((els) =>
    els.map((el) => (el as HTMLInputElement).value),
  );
}

export function rowCount(page: Page): Promise<number> {
  return rowInputs(page).count();
}

/// ---- 剪贴板与粘贴 ----

/// 把文本写进系统剪贴板。
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

/// 读系统剪贴板的纯文本（同样走 Base64，避免中文被代码页打成乱码）
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

/// 点进第 index 行后按 Ctrl+V（真实剪贴板粘贴，不走合成事件）
export async function pasteText(page: Page, index: number): Promise<void> {
  await rowInput(page, index).click();
  await page.keyboard.press("Control+V");
}

/// ---- 落盘（dnote.txt）----

/// 解码 `dnote.txt`：与 `infra/store.rs` 的 `decode_lines` 同一套规则
/// （写入时每行都以 `\n` 结尾；读取时丢弃末尾由终止换行产生的空串，兼容 CRLF）。
export function decodeLines(raw: string): string[] {
  const lines = raw.split("\n").map((l) => (l.endsWith("\r") ? l.slice(0, -1) : l));
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

/// 按 `infra/store.rs` 的写入规则编码（每行都以 `\n` 结尾，含最后一行）
export function encodeLines(lines: string[]): string {
  return lines.map((l) => `${l}\n`).join("");
}

/// 启动前预置数据文件（在 launchApp 之前调用），让初始内容确定下来、不必用 UI 造数据
export function writeDataFile(dataDir: string, lines: string[]): void {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, "dnote.txt"), encodeLines(lines), "utf8");
}

/// 读落盘的行；文件不存在视为空列表
export function readPersistedLines(dataDir: string): string[] {
  const file = path.join(dataDir, "dnote.txt");
  if (!fs.existsSync(file)) return [];
  return decodeLines(fs.readFileSync(file, "utf8"));
}

/// 等落盘的行与期望一致（写文件是异步的）
export function expectPersistedLines(dataDir: string, lines: string[]): Promise<void> {
  return expect
    .poll(() => readPersistedLines(dataDir), { timeout: 3_000 })
    .toEqual(lines);
}

/// ---- 用例分节日志 ----

/// 带 auto fixture 的 `test`：每个用例自动在 dnote.log 里记一行开始、一行结束（结果 + 耗时）。
/// spec 侧零改动 —— 从本模块 import `test` 即可（与 paim 的约定一致）。
/// 日志里因此能按用例切段，一眼看出失败用例之前都发生了什么。
export const test = base.extend<{ testSection: void }>({
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
});
