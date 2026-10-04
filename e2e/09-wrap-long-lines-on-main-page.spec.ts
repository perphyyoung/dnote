/**
 * 长行按右边界折行：折行只改**排版** —— 逻辑行仍是 `\n` 那一行，
 * 而手柄 / 当前行高亮 / 拖拽落点的几何全部按「逻辑行的排版块」走（来自镜像测层）。
 *
 * 断言口径：能独立量的就独立量（镜像总高 vs textarea **自己**排出来的 `scrollHeight`，
 * 后者是浏览器算的、不是我们算的），其余用**行为**断言（拖拽结果、悬停命中哪一行、高亮高度），
 * 避免"自己和自己对答案"。
 */
import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import {
  caretTo,
  dragLine,
  editorText,
  expectPersistedLines,
  lineHandles,
  mirrorBoxes,
  rowHeight,
  seedLines,
  test,
} from "./e2e-helpers";

// 上下留白与 `NoteEditor.vue` 一致（跨语言无法共享，改了要同步）。
// **行高不写死**：它由字号按比例派生，字号用户可改、也会被同 worker 的其它 spec 留下痕迹，
// 所以一律用 `rowHeight(page)` 从页面读。
const PAD_TOP = 8;
const PAD_BOTTOM = 16;

/// 够长到**任何**窗口宽度下都会折行（一行中文约 14px 宽，这里约 150 字 ≈ 2100px；
/// e2e 实例会从窗口状态插件恢复上次的尺寸，别假设窗口就是配置里那个 360 宽）
const LONG =
  "这一行很长很长很长会一直写到右边界然后自动折行再接着写下去直到折成好几行这样才能验证手柄与高亮是否都按整块走" +
  "折行以后逻辑行仍然只有一个但视觉上会占好几个视觉行拖拽时抓的还是这一整块手柄也应该跟着这一块居中显示" +
  "再多写一点以免窗口很宽时反而不折行那样这条用例就白测了";

const NOTE = ["第一行", LONG, "第三行"];

/// 镜像的内容总高必须等于 textarea 自己的内容高（`scrollHeight` 由浏览器排版得出）
async function expectMirrorMatchesTextarea(page: Page): Promise<void> {
  const measured = await page.evaluate((pad) => {
    const area = document.querySelector("textarea");
    const mirror = document.querySelector("[data-mirror]");
    const first = mirror?.firstElementChild?.getBoundingClientRect();
    const last = mirror?.lastElementChild?.getBoundingClientRect();
    if (!(area instanceof HTMLTextAreaElement) || !first || !last) return null;
    return { mirror: last.bottom - first.top, textarea: area.scrollHeight - pad };
  }, PAD_TOP + PAD_BOTTOM);
  if (measured === null) throw new Error("量不到镜像或 textarea");
  expect(Math.abs(measured.mirror - measured.textarea)).toBeLessThanOrEqual(1);
}

test.describe("长行折行后的排版几何", () => {
  test.beforeEach(async ({ app, page }) => {
    await seedLines(app, page, NOTE);
  });

  test("折行行的手柄只在首个视觉行：一个行高、贴着块的上沿", async ({ page }) => {
    const ROW_H = await rowHeight(page);
    const boxes = await mirrorBoxes(page);
    expect(boxes).toHaveLength(3);
    expect(boxes[1].height).toBeGreaterThan(ROW_H * 1.5); // 前提：这一行确实折了

    const handle = await lineHandles(page).nth(1).boundingBox();
    if (!handle) throw new Error("取不到折行行的手柄");
    // 手柄只占一个行高（折行块再高也不跟着变胖，免得视觉负担），且贴在块的首个视觉行
    expect(Math.abs(handle.height - ROW_H)).toBeLessThanOrEqual(1);
    expect(Math.abs(handle.y - boxes[1].top)).toBeLessThanOrEqual(1);
  });

  test("悬停在折行块的下部，命中的仍是这一行（不是按均匀行高算飞了）", async ({ page }) => {
    const boxes = await mirrorBoxes(page);
    // 块底部往上 4px：均匀行高算法会算到第 3 行去（那里没有行），实测行盒必须仍判给第 2 行
    await page.mouse.move(120, boxes[1].top + boxes[1].height - 4);
    await expect(lineHandles(page).nth(1)).toHaveCSS("opacity", "1");
    await expect(lineHandles(page).nth(2)).toHaveCSS("opacity", "0");
  });

  test("折行行的当前行高亮覆盖整块（上沿与高度都跟行盒一致）", async ({ page }) => {
    await caretTo(page, 1, 2);
    const boxes = await mirrorBoxes(page);
    const highlight = page.locator("[data-caret-line]");
    await expect(highlight).toHaveAttribute("data-caret-line", "1");

    const box = await highlight.boundingBox();
    if (!box) throw new Error("取不到高亮元素");
    expect(Math.abs(box.height - boxes[1].height)).toBeLessThanOrEqual(1);
    expect(Math.abs(box.y - boxes[1].top)).toBeLessThanOrEqual(1);
  });

  test("折行笔记里拖拽仍按逻辑行搬动，且能 Ctrl+Z 撤回", async ({ page, app }) => {
    await dragLine(page, 1, 2); // 把折行的那一行拖到末尾（手柄盒很高也不影响）
    expect(await editorText(page)).toBe(["第一行", "第三行", LONG].join("\n"));
    await expectPersistedLines(app.dataDir, ["第一行", "第三行", LONG]);

    await page.keyboard.press("Control+z");
    expect(await editorText(page)).toBe(NOTE.join("\n"));
    await expectPersistedLines(app.dataDir, NOTE);
  });

  test("拖到折行块所在位置：按「行优先 + 看方向」判定落点", async ({ page, app }) => {
    // 往下拖、指针落在折行块里 → 插到这一行**下面**
    await dragLine(page, 0, 1);
    expect(await editorText(page)).toBe([LONG, "第一行", "第三行"].join("\n"));

    await seedLines(app, page, NOTE);
    // 往上拖、指针同样落在折行块里 → 插到这一行**上面**
    await dragLine(page, 2, 1);
    expect(await editorText(page)).toBe(["第一行", "第三行", LONG].join("\n"));
    await expectPersistedLines(app.dataDir, ["第一行", "第三行", LONG]);
  });

  test("镜像与 textarea 的排版一致：总高相等，缩窄容器重测后仍相等", async ({ page }) => {
    await expectMirrorMatchesTextarea(page);

    const before = (await mirrorBoxes(page))[1].height;
    await page.evaluate(() => {
      const area = document.querySelector("textarea");
      const scroller = area?.parentElement;
      if (scroller instanceof HTMLElement) scroller.style.width = "200px";
    });
    // 宽度一变折行位置就变：ResizeObserver 必须重测（块变高），且重测后依然与 textarea 一致
    await expect
      .poll(async () => (await mirrorBoxes(page))[1].height, { timeout: 2_000 })
      .toBeGreaterThan(before);
    await expectMirrorMatchesTextarea(page);
  });

  test("反向守护：短行不折行时几何与今天一致（手柄逐行等距、正好一个行高）", async ({
    app,
    page,
  }) => {
    const short = ["第一行", "第二行", "第三行"];
    await seedLines(app, page, short);

    const ROW_H = await rowHeight(page);
    const boxes = await mirrorBoxes(page);
    for (const [index, box] of boxes.entries()) {
      expect(Math.abs(box.height - ROW_H)).toBeLessThanOrEqual(1);
      const handle = await lineHandles(page).nth(index).boundingBox();
      if (!handle) throw new Error(`取不到第 ${index} 行的手柄`);
      expect(Math.abs(handle.y - box.top)).toBeLessThanOrEqual(1);
    }
  });
});
