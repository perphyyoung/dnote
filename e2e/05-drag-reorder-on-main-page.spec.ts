/**
 * 拖拽调序：按住行首悬停出现的手柄上下拖动，行序跟着指针走，松手落盘。
 *
 * 编辑语义都交给了浏览器，**拖拽是本项目唯一自研的交互**，所以它必须有自己的 e2e
 * （此前只有 vitest 覆盖了纯函数 dropIndex / moveItem，没人验证过手柄与指针这条链路）。
 *
 * 断言口径：既看界面上的行序，也核对落盘的 `dnote.txt` —— 拖拽中只改前端状态，
 * 必须在松手那一刻落盘。
 */
import { expect } from "@playwright/test";
import {
  caretTo,
  dragLine,
  dragLineWith,
  editorText,
  expectPersistedLines,
  readPersistedLines,
  seedLines,
  selection,
  test,
} from "./e2e-helpers";
import { e2eLog } from "./e2e-logger";

const LINES = ["第一行", "第二行", "第三行"];

test.describe("拖拽调整行序", () => {
  test.beforeEach(async ({ app, page }) => {
    await seedLines(app, page, LINES);
  });

  test("按住第一行的手柄往下拖到最后", async ({ page, app }) => {
    await dragLine(page, 0, 2);

    const text = await editorText(page);
    e2eLog.info("[drag] 往下拖后的内容", text);

    expect(text).toBe("第二行\n第三行\n第一行");
    await expectPersistedLines(app.dataDir, ["第二行", "第三行", "第一行"]);
  });

  test("按住最后一行的手柄往上拖到最前", async ({ page, app }) => {
    await dragLine(page, 2, 0);

    expect(await editorText(page)).toBe("第三行\n第一行\n第二行");
    await expectPersistedLines(app.dataDir, ["第三行", "第一行", "第二行"]);
  });

  test("拖到半行以内不换位（阈值）", async ({ page, app }) => {
    // 只移动小于半行高的距离：指针仍在原来那一行，插入位等于「没动」
    await dragLineWithinHalfRow(page);

    expect(await editorText(page)).toBe(LINES.join("\n"));
    await expectPersistedLines(app.dataDir, LINES);
  });

  test("拖拽后光标跟着被拖的那一行，不会跳到文末", async ({ page }) => {
    await caretTo(page, 0, 2); // 当前行 = 第 1 行第 2 列
    await dragLine(page, 0, 2); // 把它拖到最后

    expect(await editorText(page)).toBe("第二行\n第三行\n第一行");
    // 被拖的那一行现在是第 3 行：光标应停在第 3 行第 2 列（"第二行\n第三行\n" = 8，+2 = 10），
    // 而不是被直接改 value 甩到文末（那会得到 { start: 11, end: 11 }）
    expect(await selection(page)).toEqual({ start: 10, end: 10 });
    await expect(page.locator("[data-caret-line]")).toHaveAttribute("data-caret-line", "2");
  });

  test("拖别的行时，光标留在原来那一行内容上", async ({ page }) => {
    await caretTo(page, 2, 1); // 当前行 = 第 3 行「第三行」
    await dragLine(page, 0, 2); // 把第 1 行拖到最后

    // 内容变成 第二行 / 第三行 / 第一行：原来第 3 行的「第三行」被顶到第 2 行，光标跟着它到 (1, 1)
    expect(await selection(page)).toEqual({ start: 5, end: 5 });
  });

  test("拖拽搬动也能 Ctrl+Z 撤回来（与快捷键同一条实现路径）", async ({ page, app }) => {
    await caretTo(page, 0, 1);
    await dragLine(page, 0, 2);
    expect(await editorText(page)).toBe("第二行\n第三行\n第一行");
    await expectPersistedLines(app.dataDir, ["第二行", "第三行", "第一行"]);

    await page.keyboard.press("Control+z");
    expect(await editorText(page)).toBe(LINES.join("\n"));
    await expectPersistedLines(app.dataDir, LINES);
    // 撤销后光标回到拖拽前的位置，且没有选区（撤销会恢复编辑前的选区，applyEdit 已处理）
    expect(await selection(page)).toEqual({ start: 1, end: 1 });
  });

  test("拖动中不动内容，松手才换位并落盘", async ({ page, app }) => {
    await dragLineWith(page, 0, 2, async () => {
      // 此刻指针已到落点、还没松手。停住 500ms（超过 400ms 落盘防抖）：
      // 若实现是「边拖边改文本 / 边落盘」，这两条断言立刻会抓到。
      await page.waitForTimeout(500);
      expect(await editorText(page)).toBe(LINES.join("\n"));
      expect(readPersistedLines(app.dataDir)).toEqual(LINES);
    });

    expect(await editorText(page)).toBe("第二行\n第三行\n第一行");
    await expectPersistedLines(app.dataDir, ["第二行", "第三行", "第一行"]);
  });
});

/// 按住第一行手柄只往下挪 10px（< 半行 14px）后松手：顺序必须原样不动
async function dragLineWithinHalfRow(page: import("@playwright/test").Page): Promise<void> {
  const handle = await page.getByRole("button", { name: "拖拽调整顺序" }).first().boundingBox();
  if (!handle) throw new Error("取不到第一行的手柄位置");
  const x = handle.x + handle.width / 2;
  const y = handle.y + handle.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + 10, { steps: 4 });
  await page.mouse.up();
}
