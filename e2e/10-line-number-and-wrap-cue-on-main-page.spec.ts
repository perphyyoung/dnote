/**
 * 折行的视觉反馈（做完减法之后）：**续行拐弯箭头**（每个续行前常显一个）
 * + **拖拽源块的虚线上下沿**。
 *
 * 行号已经删掉 —— 左侧槽只留「拖拽手柄（只在逻辑行的首个视觉行）+ 续行箭头」，
 * 所以这里也带一条"没有行号"的守护，免得以后又长回来。
 */
import { expect } from "@playwright/test";
import { dragLineWith, hoverRow, lineHandles, mirrorBoxes, seedLines, test } from "./e2e-helpers";

// 与 `NoteEditor.vue` 一致（跨语言无法共享，改了要同步）
const ROW_H = 28;

/// 够长到任何窗口宽度下都折行（详见 09 的说明）
const LONG =
  "这一行很长很长很长会一直写到右边界然后自动折行再接着写下去直到折成好几行这样才能验证手柄与高亮是否都按整块走" +
  "折行以后逻辑行仍然只有一个但视觉上会占好几个视觉行拖拽时抓的还是这一整块手柄也应该跟着这一块居中显示" +
  "再多写一点以免窗口很宽时反而不折行那样这条用例就白测了";

const NOTE = ["第一行", LONG, "第三行"];

/// 第 index 行占几个视觉行
function spanOf(height: number): number {
  return Math.max(1, Math.round(height / ROW_H));
}

test.describe("折行的视觉反馈", () => {
  test.beforeEach(async ({ app, page }) => {
    await seedLines(app, page, NOTE);
  });

  test("续行拐弯箭头：每个续行前一个，位置对齐各续行，且常显", async ({ page }) => {
    const boxes = await mirrorBoxes(page);
    const span = spanOf(boxes[1].height);
    expect(span).toBeGreaterThan(1); // 前提：这一行确实折了

    const arrows = page.locator("[data-continuation-arrow]");
    await expect(arrows).toHaveCount(span - 1);
    for (let row = 1; row < span; row += 1) {
      const box = await arrows.nth(row - 1).boundingBox();
      if (!box) throw new Error(`取不到第 ${row} 个拐弯箭头`);
      expect(Math.abs(box.y - (boxes[1].top + row * ROW_H))).toBeLessThanOrEqual(1);
    }

    // 常显：指针不在这两行上也看得见（此时手柄是收起的）
    await page.mouse.move(200, 2);
    await expect(arrows.first()).toBeVisible();
    await expect(lineHandles(page).nth(1)).toHaveCSS("opacity", "0");
  });

  test("两种左槽标记共用同一条竖中线：箭头与手柄的水平中心重合", async ({ page }) => {
    const boxes = await mirrorBoxes(page);
    const span = spanOf(boxes[1].height);
    expect(span).toBeGreaterThan(1); // 前提：这一行确实折了，才有续行箭头可比

    // 箭头与手柄是同一套盒子（`width: HANDLE_W` + 水平居中），所以**盒子中心就是字形中心**。
    // 箭头曾经是 `left: 0; width: 7px`（贴左边），于是比手柄偏左约 6px —— 这条就是那个回归的护栏。
    // 两者永不同行（手柄只在首个视觉行、箭头只在续行），因此共用一条中线不会互相压住。
    const handle = await lineHandles(page).nth(1).boundingBox();
    const arrow = await page.locator("[data-continuation-arrow]").first().boundingBox();
    if (!handle || !arrow) throw new Error("取不到手柄或拐弯箭头的位置");
    const handleCenter = handle.x + handle.width / 2;
    const arrowCenter = arrow.x + arrow.width / 2;
    expect(Math.abs(arrowCenter - handleCenter)).toBeLessThanOrEqual(1);
  });

  test("拖拽时源块带虚线上下沿，高度就是这一块的高度", async ({ page }) => {
    const boxes = await mirrorBoxes(page);
    await dragLineWith(page, 1, 2, async () => {
      const source = page.locator("[data-drag-source]");
      await expect(source).toHaveCSS("border-top-style", "dashed");
      await expect(source).toHaveCSS("border-bottom-style", "dashed");
      const box = await source.boundingBox();
      if (!box) throw new Error("取不到源块");
      expect(Math.abs(box.height - boxes[1].height)).toBeLessThanOrEqual(1);
      expect(box.height).toBeGreaterThan(ROW_H * 1.5); // 前提：源块是折行的高块
    });
  });

  test("左侧槽只有手柄与拐弯箭头，没有行号（视觉负担已减）", async ({ page }) => {
    await hoverRow(page, 2);
    const cell = lineHandles(page).nth(2);
    await expect(cell).toHaveCSS("opacity", "1");
    await expect(cell).toHaveText("⠿"); // 手柄就是一个字形，没有多余文字
    await expect(page.locator("[data-line-number]")).toHaveCount(0);
  });

  test("箭头不抢交互：悬停后在文字上点击仍按列落光标", async ({ page }) => {
    await hoverRow(page, 1);
    const boxes = await mirrorBoxes(page);
    await page.mouse.click(240, boxes[1].top + 6);

    await expect(page.locator("[data-caret-line]")).toHaveAttribute("data-caret-line", "1");
    const caret = await page.evaluate(() => {
      const area = document.querySelector("textarea");
      return area instanceof HTMLTextAreaElement ? area.selectionStart : -1;
    });
    expect(caret).toBeGreaterThan(4); // 第一行是 0..2，"第一行\n" 之后从 4 起
  });

  test("反向守护：不折行的笔记里没有拐弯箭头，手柄照常在行首", async ({ app, page }) => {
    await seedLines(app, page, ["第一行", "第二行", "第三行"]);
    await expect(page.locator("[data-continuation-arrow]")).toHaveCount(0);

    const boxes = await mirrorBoxes(page);
    const handle = await lineHandles(page).nth(1).boundingBox();
    if (!handle) throw new Error("取不到第二行手柄");
    expect(Math.abs(handle.y - boxes[1].top)).toBeLessThanOrEqual(1);
    expect(Math.abs(handle.height - ROW_H)).toBeLessThanOrEqual(1);
  });
});
