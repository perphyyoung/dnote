/**
 * 多行拖拽：选中多行后，抓选区内任意一行的手柄，把手柄所在的行范围**整块**搬到新位置。
 *
 * 与 `05` 的分工：`05` 只覆盖单行拖拽（手柄 / 幽灵行 / 插入线 / 撤销那套链路），
 * 这里补「选区参与拖拽」的三条边界 —— 整块搬、块内顺序不变、抓选区外仍只搬一行。
 *
 * 单选区的建立走真实键盘（`Shift+↓`），不直接改 selectionStart/End：拖拽起手时读的就是
 * textarea 的原生选区，用键盘建立才和用户真实操作一致。
 */
import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import {
  caretTo,
  dragLine,
  dragLineWith,
  editorText,
  expectPersistedLines,
  rowHeight,
  seedLines,
  selection,
  test,
} from "./e2e-helpers";
import { e2eLog } from "./e2e-logger";

const LINES = ["第一行", "第二行", "第三行", "第四行", "第五行"];
/// 把第 2–3 行（下标 1–2）整块拖到末尾之后的行
const MOVED = ["第一行", "第四行", "第五行", "第二行", "第三行"];

/// 从第 first 行行首选到第 last 行末尾：按 `Shift+↓` 共 last − first + 1 次，停在 last + 1 行行首。
/// 那个位置按 `[from, to)` 不算选中 last + 1 行 —— 于是选区正好覆盖 first..last（与 `selectionLines` 同口径）。
async function selectLines(page: Page, first: number, last: number): Promise<void> {
  await caretTo(page, first, 0);
  for (let line = first; line <= last; line += 1) await page.keyboard.press("Shift+ArrowDown");
}

test.describe("多行拖拽调序", () => {
  test.beforeEach(async ({ app, page }) => {
    await seedLines(app, page, LINES);
  });

  test("抓块内第一行的手柄，整个行范围一起搬到末尾", async ({ page, app }) => {
    await selectLines(page, 1, 2);
    await dragLineWith(page, 1, 4, async () => {
      // 幽灵行显示的是整块：两行都在，角标交代块大小
      const ghost = page.locator("[data-drag-ghost]");
      await expect(ghost).toContainText("第二行");
      await expect(ghost).toContainText("第三行");
      await expect(ghost).toContainText("2 行");
    });

    const text = await editorText(page);
    e2eLog.info("[multiline-drag] 整块下移后的内容", text);
    expect(text).toBe(MOVED.join("\n"));
    // 块内顺序不变：第二行仍在第三行上面
    await expectPersistedLines(app.dataDir, MOVED);
  });

  test("抓块内第二行的手柄同样搬整块，松手后选区仍覆盖搬过去的块", async ({ page }) => {
    await selectLines(page, 1, 2);
    await dragLine(page, 2, 4); // 抓的是块末行，不是块首

    const text = await editorText(page);
    expect(text).toBe(MOVED.join("\n"));
    // 选区保留并整体平移到新位置：选中文本仍是原来的两行
    const sel = await selection(page);
    expect(text.slice(sel.start, sel.end)).toBe("第二行\n第三行");
  });

  test("拖回块内等于没动：不画插入线、文本与磁盘都不变", async ({ page, app }) => {
    await selectLines(page, 1, 2);
    await dragLineWith(page, 1, 1, async () => {
      // 指针停在块内：插入位落在 [块首, 块末 + 1]，不该出现插入线
      await expect(page.locator("[data-insert-line]")).toHaveCount(0);
    });

    expect(await editorText(page)).toBe(LINES.join("\n"));
    await expectPersistedLines(app.dataDir, LINES);
  });

  test("抓选区外的手柄仍只搬那一行", async ({ page }) => {
    await selectLines(page, 1, 2);
    await dragLine(page, 4, 0); // 第五行在选区外

    expect(await editorText(page)).toBe(
      ["第五行", "第一行", "第二行", "第三行", "第四行"].join("\n"),
    );
  });

  test("整块搬动也能 Ctrl+Z 撤回，且撤销后不带选区", async ({ page, app }) => {
    await selectLines(page, 1, 2);
    await dragLine(page, 1, 4);
    expect(await editorText(page)).toBe(MOVED.join("\n"));

    await page.keyboard.press("Control+z");
    expect(await editorText(page)).toBe(LINES.join("\n"));
    await expectPersistedLines(app.dataDir, LINES);
    const sel = await selection(page);
    expect(sel.start).toBe(sel.end);
  });

  test("大块幽灵行封顶 6 行，总行数由角标交代", async ({ page, app }) => {
    const eight = Array.from({ length: 8 }, (_, i) => `第 ${i + 1} 行`);
    await seedLines(app, page, eight);
    // 选前 7 行（块比幽灵行上限大），拖到第 8 行下面：这是个真落点，插入线要出现
    await selectLines(page, 0, 6);
    const rowH = await rowHeight(page);

    await dragLineWith(page, 0, 7, async () => {
      const ghost = page.locator("[data-drag-ghost]");
      await expect(ghost).toContainText("7 行");
      const box = await ghost.boundingBox();
      if (!box) throw new Error("取不到幽灵行的大小");
      expect(Math.round(box.height)).toBe(6 * rowH);
      await expect(page.locator("[data-insert-line]")).toHaveCount(1);
    });

    expect(await editorText(page)).toBe([...eight.slice(7), ...eight.slice(0, 7)].join("\n"));
  });
});
