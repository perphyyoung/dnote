/**
 * Show Desktop（`Win+D`）：**主窗口尺寸必须前后一致**，窗口还得自己回来。
 *
 * 为什么盯这条：主窗口改成 `skipTaskbar: false`（任务栏与 Alt+Tab 里都可见）之后，它重新成为
 * Show Desktop 的目标；而它给窗口的那一下子会让 `tauri-plugin-window-state` 把尺寸记坏 ——
 * 曾经的表现是「`Win+D` 之后窗口回不来、重启只剩一条标题栏，只能手工删状态文件」（见
 * `开发经验.md` §1.6）。这条用例就是那件事的护栏：
 * 按一次（整机窗口最小化）、再按一次（还原），尺寸必须与之前**逐像素相同**。
 *
 * 三处容易踩的坑（都写在实现里，改这条用例前先读）：
 * - `Win+D` 是**整机级开关**，必须包在 `withShowDesktop` 里串行（并行 worker 各按各的会互相抵消）。
 * - 合成按键要能**证明生效**（整机最小化窗口数变大），否则「尺寸一致」可能只是"两边都没变"。
 * - 注入按键别用 `SendInput`（`cbSize` 结构体陷阱，会静默失败），用 `keybd_event`。
 */
import { expect } from "@playwright/test";
import {
  editor,
  foregroundClass,
  minimizedWindowCount,
  seedLines,
  showDesktop,
  test,
  windowRect,
  withShowDesktop,
} from "./e2e-helpers";
import { e2eLog } from "./e2e-logger";

test.describe("Win+D（Show Desktop）", () => {
  test("按一次再按一次：窗口尺寸逐像素不变，且窗口自己回来", async ({ app, page }) => {
    // 锁等待 + 好几轮 PowerShell 往返，比常规用例慢；慢在等锁上，不是被测逻辑在抖
    test.slow();
    const pid = app.child.pid;
    if (pid === undefined) throw new Error("拿不到实例 pid");
    // 先给点内容：窗口真被压成一条标题栏时编辑器也跟着不可用，末尾顺带验一下页面还活着
    await seedLines(app, page, ["第一行", "第二行"]);

    const before = await windowRect(pid);
    expect(before.minimized, "起点不该是最小化态").toBe(false);
    const minBefore = minimizedWindowCount();
    e2eLog.info(
      `[win+d] 起点 size=${before.width}x${before.height} 最小化窗口=${minBefore} 前台=${foregroundClass()}`,
    );

    // **整段场景持锁**：不只是两次按键之间 —— 断言也在锁外的话，别的 worker 一按键就把
    // 我们刚断言过的窗口又最小化了（实测过：`--repeat-each=3` 并行时后读到的几何是 -32000）。
    await withShowDesktop(async () => {
      showDesktop(); // 显示桌面
      // 判据一：这一下**真的生效**（整机一堆窗口变最小化）。少了它，后面「尺寸一致」有可能是
      // "两边都没变"的同义反复 —— 合成按键压根没生效时，用例会假绿。
      await expect
        .poll(() => minimizedWindowCount(), { timeout: 3_000 })
        .toBeGreaterThan(minBefore);
      e2eLog.info(`[win+d] 显示桌面已生效：最小化窗口 ${minBefore} → ${minimizedWindowCount()}`);
      // 判据二：窗口跟着最小化（说明 Show Desktop 真的会碰 dnote 这个窗口）
      await expect.poll(() => windowRect(pid).minimized, { timeout: 5_000 }).toBe(true);

      showDesktop(); // 再按一次：窗口应当回到原样

      // 窗口必须**自己回来**（旧 bug 正是「Win+D 之后窗口没回来」）
      await expect.poll(() => windowRect(pid).minimized, { timeout: 5_000 }).toBe(false);
      const after = await windowRect(pid);
      e2eLog.info(
        `[win+d] 终点 size=${after.width}x${after.height} 最小化窗口=${minimizedWindowCount()} 前台=${foregroundClass()}`,
      );
      expect(after, "Win+D 前后窗口几何应当一致").toEqual(before);

      // 页面还活着：把光标移到文末还能打字
      await editor(page).click();
      await page.keyboard.press("Control+End");
      await page.keyboard.type("x");
      await expect(editor(page)).toHaveValue("第一行\n第二行x");
    });
  });
});
