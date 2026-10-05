/**
 * 次级面板：主面板**右侧**那一栏（默认收起），放不常改的笔记。同一个窗口、同一套操作，
 * 但**存储分开** —— 主面板写 `dnote.txt`，次级面板写 `dnote-secondary.txt`（见 `infra/store.rs`）。
 *
 * 四条口径：
 * - 展开 = 把窗口加宽一栏（不是开第二个窗口）：主面板那条边不动，右边长出一栏，两栏同高同位。
 * - **窗口宽 = 主面板宽 + 次级面板宽**，两个拖拽点各改它左侧那一栏：窗口右缘改次级（主面板是
 *   固定宽 + 次级 `flex-1` 吸收增量）、两栏之间的分界线改主面板（次级让位、窗口不动）。
 * - 两块面板各是一个 `NoteEditor` 实例，只差 `panel` 这个 prop：所以「所有操作一样」不是靠
 *   用例逐条抄一遍主面板的用例，而是靠同一套组件与同一对命令 —— 这里只挑两件事盯着：
 *   拖拽调序照旧落盘，以及**几何是各量各的**（次级面板自己的折行、续行箭头）。
 * - 两个偏好在 localStorage（与其它界面偏好同源）：是否展开、**次级面板宽度**（主面板宽度是
 *   会话内的，不落盘 —— 关闭态下它就是窗口宽）。同一 worker 的其它 spec 共用这份 profile，
 *   留着展开偏好会让 09/10/12 面对**两个** textarea（strict mode 直接报冲突），用例结束必须复位。
 */
import fs from "node:fs";
import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import {
  dragLine,
  editor,
  editorText,
  expectPersistedLines,
  mirrorBoxes,
  notesFile,
  readPersistedLines,
  resizeWindowBy,
  rowHeight,
  seedLines,
  test,
} from "./e2e-helpers";
import { e2eLog } from "./e2e-logger";

/// 与 `features/settings/secondaryPanel.ts` 的 KEY 一致（跨语言无法共享常量）
const PANEL_KEY = "dnote:secondary-panel";
const WIDTH_KEY = "dnote:secondary-panel-width";

const MAIN_NOTE = ["主面板第一条", "主面板第二条"];
const SECONDARY_NOTE = ["次级第一条", "次级第二条", "次级第三条"];
/// 长到会折行：次级面板每个实例都要自己量一次折行几何（手柄与续行箭头都读它）
const WRAPPING = "折行判定要用实测几何，".repeat(12);

const handle = (page: Page) => page.getByRole("button", { name: "次级面板" });
const frame = (page: Page) => page.locator('[data-panel-frame="secondary"]');
/// 视口宽度（客户区，逻辑像素）：窗口加宽 / 收窄都看它，不必碰 Tauri 的窗口 API
const viewportWidth = (page: Page) => page.evaluate(() => window.innerWidth);
const rect = (page: Page, selector: string) =>
  page.locator(selector).evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { top: r.top, height: r.height, width: r.width };
  });

test.describe("次级面板", () => {
  test.beforeEach(async ({ app, page }) => {
    // 偏好先清掉（上一条用例可能留下展开偏好与拖出来的次级宽度），`seedLines` 里的 reload 会让它生效
    await page.evaluate(
      (keys) => keys.forEach((key) => localStorage.removeItem(key)),
      [PANEL_KEY, WIDTH_KEY],
    );
    await seedLines(app, page, MAIN_NOTE);
  });

  test.afterEach(async ({ page }) => {
    // **收尾必须真的走一次收起**：窗口宽度是开关那一下当场加减的，光清偏好 + 重载**收不回**那一栏
    // （reload 不改窗口尺寸）。留下的宽几何会被 window-state 写进
    // `%APPDATA%\com.dnote.perphyyoung\window-state.dev.json`，而那份 dev 与 e2e **共用** ——
    // 于是每跑一轮就再宽一栏（实测：主面板越来越宽，右边界都跑到屏幕外了）。
    try {
      if ((await frame(page).count()) > 0) await handle(page).click();
    } catch (e) {
      e2eLog.warn("[secondary] 收尾收起次级面板失败", String(e));
    }
    await page.evaluate(
      (keys) => keys.forEach((key) => localStorage.removeItem(key)),
      [PANEL_KEY, WIDTH_KEY],
    );
    await page.reload(); // 复位后重载：下一个 spec 面对的是「默认收起」的界面
  });

  test("默认收起：不展开就没有次级面板，也不会凭空创建次级文件", async ({ app, page }) => {
    await expect(frame(page)).toHaveCount(0);
    await expect(editor(page, "secondary")).toHaveCount(0);
    // 读取不创建文件：藏着的时候不该多出一个空文件（本条因此必须排在任何次级写入之前）
    expect(fs.existsSync(notesFile(app.dataDir, "secondary"))).toBe(false);
  });

  test("把手展开 / 收起：窗口宽出正好一栏，两栏同高同位", async ({ page }) => {
    const before = await viewportWidth(page);
    await expect(handle(page)).toHaveAttribute("aria-expanded", "false");

    await handle(page).click();
    await expect(handle(page)).toHaveAttribute("aria-expanded", "true");
    await expect(frame(page)).toBeVisible();

    const secondary = await rect(page, '[data-panel-frame="secondary"]');
    const main = await rect(page, '[data-panel="main"]');
    e2eLog.info("[secondary] 展开几何", JSON.stringify({ before, secondary, main }));
    // 判据用**面板自己的宽度**，不写死数字：窗口必须宽出正好一栏
    await expect
      .poll(() => viewportWidth(page))
      .toBeGreaterThanOrEqual(before + secondary.width - 1);
    // 两栏是同一行：上沿对齐、高度相同
    expect(secondary.top).toBeCloseTo(main.top, 0);
    expect(secondary.height).toBeCloseTo(main.height, 0);
    // 展开后就是那块面板的内容（次级那份种子还没播，这里只确认取到的是次级的面板）
    expect(await editor(page, "secondary").inputValue()).toBe("");

    await handle(page).click();
    await expect(frame(page)).toHaveCount(0);
    await expect
      .poll(async () => Math.abs((await viewportWidth(page)) - before))
      .toBeLessThanOrEqual(1);
  });

  test("收起后宽度回到打开前那份：反复开关与展开态重载都不累积", async ({ page }) => {
    const before = await viewportWidth(page);

    // 两轮「展开 → 重载（仍是展开态）→ 收起」：每轮都必须回到**同一个**宽度。
    // 差出一栏就说明加减不对称 —— 累计起来正是「窗口每跑一轮就宽一点、最后看不见右边界」。
    for (let round = 0; round < 2; round += 1) {
      await handle(page).click();
      await expect(frame(page)).toBeVisible();
      const wide = await viewportWidth(page);

      await page.reload(); // 展开态重载：偏好记着「开」，宽度由 window-state 恢复
      await expect(frame(page)).toBeVisible();
      const restored = await viewportWidth(page);

      await handle(page).click();
      await expect(frame(page)).toHaveCount(0);
      await expect
        .poll(async () => Math.abs((await viewportWidth(page)) - before))
        .toBeLessThanOrEqual(1);
      e2eLog.info("[secondary] 第几轮宽度", JSON.stringify({ round, before, wide, restored }));
    }

    // 收起态再重载：宽度仍是打开前那份（既不残留，也不需要"再收一次"才回来）
    await page.reload();
    await expect(frame(page)).toHaveCount(0);
    await expect
      .poll(async () => Math.abs((await viewportWidth(page)) - before))
      .toBeLessThanOrEqual(1);
  });

  test("拖分界线只改主面板宽度：次级让位、窗口不动，收起后主面板保持这份宽度", async ({ page }) => {
    const closedWidth = await viewportWidth(page);
    await handle(page).click();
    // 等窗口真的加宽再取基准：面板是**立刻**渲染的，而 `setSize` 是异步 IPC —— 点完就读会拿到
    // 旧宽度（`开发经验.md` 里"带 transition 的元素不能点完就读"是同一类坑）。
    await expect.poll(() => viewportWidth(page)).toBeGreaterThan(closedWidth);
    const windowBefore = await viewportWidth(page);
    const mainBefore = (await rect(page, '[data-panel="main"]')).width;
    const secondaryBefore = (await rect(page, '[data-panel-frame="secondary"]')).width;

    // 分界线往左拖 80px：主面板窄 80、次级正好宽 80 —— 两栏之和不变，所以**窗口一个像素都不动**
    const divider = page.getByRole("separator", { name: "拖动调整主面板宽度" });
    const at = await divider.boundingBox();
    if (!at) throw new Error("取不到分界线位置");
    await page.mouse.move(at.x + at.width / 2, at.y + at.height / 2);
    await page.mouse.down();
    await page.mouse.move(at.x + at.width / 2 - 80, at.y + at.height / 2, { steps: 8 });
    await page.mouse.up();

    const mainAfter = (await rect(page, '[data-panel="main"]')).width;
    const secondaryAfter = (await rect(page, '[data-panel-frame="secondary"]')).width;
    e2eLog.info(
      "[secondary] 拖分界线",
      JSON.stringify({ mainBefore, mainAfter, secondaryBefore, secondaryAfter }),
    );
    expect(mainBefore - mainAfter).toBeGreaterThanOrEqual(70); // 跟着指针走
    expect(mainAfter + secondaryAfter).toBeCloseTo(mainBefore + secondaryBefore, 0); // 之和不变
    expect(await viewportWidth(page)).toBe(windowBefore); // 窗口不动

    // 收起：窗口减掉的是**实际**次级宽（不是缺省值），于是窗口 = 主面板现在这份宽度
    await handle(page).click();
    await expect(frame(page)).toHaveCount(0);
    await expect
      .poll(async () => Math.abs((await viewportWidth(page)) - mainAfter))
      .toBeLessThanOrEqual(2);

    // 再展开：主面板保持刚拖出来的宽度，次级回到刚拖出来的宽度（窗口回到两栏之和）
    await handle(page).click();
    expect((await rect(page, '[data-panel="main"]')).width).toBeCloseTo(mainAfter, 0);
    expect((await rect(page, '[data-panel-frame="secondary"]')).width).toBeCloseTo(
      secondaryAfter,
      0,
    );
  });

  test("拖窗口右缘只改次级那一栏：主面板一个像素都不动", async ({ app, page }) => {
    await handle(page).click();
    const mainBefore = (await rect(page, '[data-panel="main"]')).width;
    const secondaryBefore = (await rect(page, '[data-panel-frame="secondary"]')).width;

    // 系统缩放边框只能从 OS 侧拖（Playwright 只操作页面内容）：直接 user32 的 SetWindowPos
    if (!app.child.pid) throw new Error("拿不到应用进程号");
    resizeWindowBy(app.child.pid, 120, 0);
    await expect
      .poll(async () => (await rect(page, '[data-panel-frame="secondary"]')).width)
      .toBeGreaterThanOrEqual(secondaryBefore + 110);

    const mainAfter = (await rect(page, '[data-panel="main"]')).width;
    const secondaryAfter = (await rect(page, '[data-panel-frame="secondary"]')).width;
    e2eLog.info(
      "[secondary] 拖右缘",
      JSON.stringify({ mainBefore, mainAfter, secondaryBefore, secondaryAfter }),
    );
    expect(mainAfter).toBeCloseTo(mainBefore, 0); // 主面板是固定宽：窗口增量全给次级
    expect(secondaryAfter).toBeGreaterThanOrEqual(secondaryBefore + 110);
  });

  test("存储分开：改一块面板，另一个文件一个字节都不动", async ({ app, page }) => {
    await handle(page).click();
    await seedLines(app, page, SECONDARY_NOTE, "secondary");

    // 改次级 → 主面板那份文件必须原样
    const mainBefore = fs.readFileSync(notesFile(app.dataDir, "main"), "utf8");
    await editor(page, "secondary").click();
    await page.keyboard.press("Control+End");
    await page.keyboard.type("（改）");
    await expectPersistedLines(
      app.dataDir,
      [...SECONDARY_NOTE.slice(0, -1), `${SECONDARY_NOTE.at(-1)}（改）`],
      "secondary",
    );
    expect(fs.readFileSync(notesFile(app.dataDir, "main"), "utf8")).toBe(mainBefore);

    // 反过来：改主面板，次级那份不动
    const secondaryBefore = fs.readFileSync(notesFile(app.dataDir, "secondary"), "utf8");
    await editor(page).click();
    await page.keyboard.press("Control+End");
    await page.keyboard.type("（主改）");
    await expectPersistedLines(app.dataDir, [
      ...MAIN_NOTE.slice(0, -1),
      `${MAIN_NOTE.at(-1)}（主改）`,
    ]);
    expect(fs.readFileSync(notesFile(app.dataDir, "secondary"), "utf8")).toBe(secondaryBefore);
    expect(readPersistedLines(app.dataDir, "secondary")).toHaveLength(SECONDARY_NOTE.length);
  });

  test("操作同款：次级面板里拖拽调序照样立刻落盘，且不碰主面板", async ({ app, page }) => {
    await handle(page).click();
    await seedLines(app, page, SECONDARY_NOTE, "secondary");

    await dragLine(page, 0, 2, "secondary"); // 第 1 行拖到末尾

    const moved = [SECONDARY_NOTE[1], SECONDARY_NOTE[2], SECONDARY_NOTE[0]];
    expect(await editorText(page, "secondary")).toBe(moved.join("\n"));
    await expectPersistedLines(app.dataDir, moved, "secondary");
    await expectPersistedLines(app.dataDir, MAIN_NOTE); // 主面板那份没被这次拖拽碰过
  });

  test("几何各量各的：次级面板的续行箭头逐个落在真实续行上", async ({ app, page }) => {
    await handle(page).click();
    await seedLines(app, page, ["基准行", WRAPPING, ""], "secondary");

    // 现场重测次级面板的镜像算出应有位置，再与实际渲染的箭头逐一比对
    const boxes = await mirrorBoxes(page, "secondary");
    const rowH = await rowHeight(page, "secondary");
    const expected = boxes.flatMap((b) => {
      const rows = Math.max(1, Math.round(b.height / rowH));
      return Array.from({ length: rows - 1 }, (_, k) => b.top + (k + 1) * rowH);
    });
    const actual = await page
      .locator('[data-panel="secondary"] [data-continuation-arrow]')
      .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().top));
    e2eLog.info("[secondary] 续行箭头", JSON.stringify({ rowH, expected, actual }));

    expect(expected.length).toBeGreaterThan(0); // 前提：长行确实折了，这条才有意义
    expect(actual.length).toBe(expected.length);
    actual.forEach((top, i) => expect(Math.abs(top - expected[i])).toBeLessThanOrEqual(1));
  });

  test("展开状态记在偏好里：重载后仍是展开的，窗口也没被收回一栏宽", async ({ page }) => {
    await handle(page).click();
    const wide = await viewportWidth(page);

    await page.reload();
    await expect(handle(page)).toHaveAttribute("aria-expanded", "true");
    await expect(frame(page)).toBeVisible();
    // 宽度由 window-state 恢复（不是我们记的）：还原出来仍是两栏的宽度
    await expect.poll(() => viewportWidth(page)).toBeGreaterThanOrEqual(wide - 1);
    expect(await page.evaluate((key) => localStorage.getItem(key), PANEL_KEY)).toBe("1");
  });
});
