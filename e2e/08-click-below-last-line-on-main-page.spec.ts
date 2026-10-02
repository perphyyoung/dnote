/**
 * 「最后一行下方」的点击：textarea 自己内部那 16px 底部留白归浏览器（原生就落到文末），
 * 而它下面的**容器空白区**必须由我们兜住 —— 否则那是一片死区：点一下只会让编辑器失焦，
 * 光标原地不动、接着打字一个字都进不去。
 *
 * 断言口径：既看焦点与光标，也**接着打字**看字符是否真的进得去（这才是用户要的能力），
 * 并核对落盘 —— 只断言"光标位置对了"不足以说明问题。
 */
import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import {
  editor,
  editorText,
  expectPersistedLines,
  seedLines,
  selection,
  test,
} from "./e2e-helpers";

const LINES = ["第一行", "第二行", "第三行"];
/// 三行笔记的文本长度（"第一行\n第二行\n第三行" = 3 + 1 + 3 + 1 + 3）
const END = LINES.join("\n").length;

/// 最后一行下沿之下 dy 像素处的一点：x 默认取文本左侧一点（避开手柄槽与右侧滚动条）。
/// 注意 **y 决定落在哪一行，x 决定落在行内哪一列**：要断言"落文末"就得让 x 落在文字右侧
/// （textarea 里那点底部留白是原生行为，比我们兜的容器空白区更"按 x 来"）。
async function belowLastLine(page: Page, dy: number, dx = 60): Promise<{ x: number; y: number }> {
  const handle = await page.getByRole("button", { name: "拖拽调整顺序" }).last().boundingBox();
  if (!handle) throw new Error("取不到最后一行手柄");
  const left = await textareaLeft(page);
  return { x: left + dx, y: handle.y + handle.height + dy };
}

async function textareaLeft(page: Page): Promise<number> {
  const left = await page.evaluate(() => {
    const area = document.querySelector("textarea");
    return area ? area.getBoundingClientRect().left : null;
  });
  if (left === null) throw new Error("取不到 textarea 左边界");
  return left;
}

async function activeTag(page: Page): Promise<string> {
  return page.evaluate(() => document.activeElement?.tagName ?? "none");
}

test.describe("点最后一行下方", () => {
  test("点容器空白区：焦点回到编辑器、光标落到文末，接着打字能追加并落盘", async ({
    page,
    app,
  }) => {
    await seedLines(app, page, LINES);
    const { x, y } = await belowLastLine(page, 60); // 60px：远在 textarea（内容 + 16px 留白）之外
    await page.mouse.click(x, y);

    expect(await activeTag(page)).toBe("TEXTAREA");
    expect(await selection(page)).toEqual({ start: END, end: END });
    await expect(page.locator("[data-caret-line]")).toHaveAttribute("data-caret-line", "2");

    await page.keyboard.type("X");
    expect(await editorText(page)).toBe(`${LINES.join("\n")}X`);
    await expectPersistedLines(app.dataDir, ["第一行", "第二行", "第三行X"]);
  });

  test("空笔记时同样：光标落到 0，能直接开始写", async ({ page, app }) => {
    await seedLines(app, page, []);
    const { x, y } = await belowLastLine(page, 60);
    await page.mouse.click(x, y);

    expect(await activeTag(page)).toBe("TEXTAREA");
    expect(await selection(page)).toEqual({ start: 0, end: 0 });
    await page.keyboard.type("X");
    expect(await editorText(page)).toBe("X");
    await expectPersistedLines(app.dataDir, ["X"]);
  });

  test("textarea 自己的底部留白仍走原生（也落文末），没有被兜底改坏", async ({ page, app }) => {
    await seedLines(app, page, LINES);
    // 6px：还在 textarea 的 16px 底部留白里；x 落到文字右侧，行内列才是"行尾"
    const { x, y } = await belowLastLine(page, 6, 240);
    await page.mouse.click(x, y);

    expect(await activeTag(page)).toBe("TEXTAREA");
    expect(await selection(page)).toEqual({ start: END, end: END });
    await page.keyboard.type("X");
    expect(await editorText(page)).toBe(`${LINES.join("\n")}X`);
  });

  test("反向守护：点最后一行内部仍是原生按列定位，不许被兜底抢走", async ({ page, app }) => {
    await seedLines(app, page, LINES);
    const handle = await page.getByRole("button", { name: "拖拽调整顺序" }).nth(1).boundingBox();
    if (!handle) throw new Error("取不到第二行手柄");
    await page.mouse.click((await textareaLeft(page)) + 58, handle.y + handle.height / 2);

    // 光标应落**第二行**里（该行区间是 [4, 7]：3 个字 + 行尾那个位置），而不是被送到文末
    await expect(page.locator("[data-caret-line]")).toHaveAttribute("data-caret-line", "1");
    const { start } = await selection(page);
    expect(start).toBeGreaterThanOrEqual(4);
    expect(start).toBeLessThanOrEqual(7);
  });

  test("反向守护：点手柄不落光标、不改文本", async ({ page, app }) => {
    await seedLines(app, page, LINES);
    await editor(page).click();
    const before = await selection(page);

    const handle = await page.getByRole("button", { name: "拖拽调整顺序" }).nth(1).boundingBox();
    if (!handle) throw new Error("取不到第二行手柄");
    await page.mouse.click(handle.x + handle.width / 2, handle.y + handle.height / 2);

    expect(await editorText(page)).toBe(LINES.join("\n"));
    expect(await selection(page)).toEqual(before);
  });
});
