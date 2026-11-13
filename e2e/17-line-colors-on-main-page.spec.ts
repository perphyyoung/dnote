/**
 * 行颜色：点进某行 → 行内操作条的「行颜色」→ 色板选色 → 行下方细线出现；
 * 可还原默认、重载记住；删掉有色行后颜色不串到下一行，Alt+↑/↓ 移动时颜色跟着行走；
 * Ctrl+D 删除后 Ctrl+Z 还原颜色回来、在有色行上方插入新行时下方颜色留在原行、
 * 清除连续空行后颜色按行号映射跟随。
 *
 * 断言只认语义：按钮用 ARIA 名、颜色标记用 `[data-line-color-underline]` 数据属性、
 * 颜色读内联 style（渐变里的色值是模板拼进去的，不钉 class、不比对 CSS 序列化）。
 */
import { expect, type Page } from "@playwright/test";
import {
  caretTo,
  editor,
  hoverRow,
  mirrorBoxes,
  rightClickLine,
  rowHeight,
  seedLines,
  test,
} from "./e2e-helpers";

const LINES = ["甲", "乙", "丙"];
// hex 进了内联渐变后会被浏览器序列化成 rgb()，断言按序列化后的值写
const RED = "rgb(244, 63, 94)"; // #f43f5e
const BLUE = "rgb(14, 165, 233)"; // #0ea5e9
const ALL_LINE_COLORS = "[data-line-color-underline]";
/// 行颜色的可见标记：行盒下沿的 1px 同色细线
const lineColor = (page: Page, index: number) =>
  page.locator(`[data-line-color-underline="${index}"]`);
/// 细线里的色值是模板拼进内联渐变的，直接查 style 里有没有这个色
async function expectColor(page: Page, index: number, color: string, message?: string) {
  const line = lineColor(page, index);
  await expect(line, message).toHaveCount(1);
  expect(await line.getAttribute("style"), message).toContain(color);
}

/// 把指针放到第 index 行并打开色板
async function openPalette(page: Page, index: number) {
  await caretTo(page, index, 0);
  await hoverRow(page, index);
  await page.getByRole("button", { name: "行颜色" }).click();
  return page.getByRole("dialog", { name: "行颜色" });
}

test.describe("行颜色", () => {
  test.beforeEach(async ({ app, page }) => {
    await seedLines(app, page, LINES);
    // 同文件共用一个 WebView profile：颜色偏好不复位会串用例
    await page.evaluate(() => localStorage.removeItem("dnote:line-colors:main"));
    await page.reload();
  });

  test("选红 → 行下方细线出现；重载仍记住；选默认还原", async ({ page }) => {
    const palette = await openPalette(page, 1);
    await expect(palette).toBeVisible();
    await palette.getByRole("button", { name: "红" }).click();

    const line = lineColor(page, 1);
    await expect(line).toBeVisible();
    await expectColor(page, 1, RED);
    await expect(line).toHaveCSS("height", "1px");
    await expect(page.locator(ALL_LINE_COLORS)).toHaveCount(1); // 只给这一行上色

    // 画在行盒下沿：top = 该行镜像行盒的底部
    const boxes = await mirrorBoxes(page);
    const rect = await line.boundingBox();
    if (!rect) throw new Error("取不到行颜色细线");
    expect(rect.y).toBeCloseTo(boxes[1].top + boxes[1].height, 0);

    await page.reload();
    await expectColor(page, 1, RED);

    const again = await openPalette(page, 1);
    await again.getByRole("button", { name: "默认" }).click();
    await expect(page.locator(ALL_LINE_COLORS)).toHaveCount(0);
  });

  test("删掉有色行不串到下一行；Alt+↓ 移动时颜色跟着行走", async ({ page }) => {
    const palette = await openPalette(page, 1);
    await palette.getByRole("button", { name: "蓝" }).click();
    await expectColor(page, 1, BLUE);

    // 行内「删除当前行」：删掉第 2 行后，原来的第 3 行顶上来但不该继承蓝色
    await hoverRow(page, 1);
    await page.getByRole("button", { name: "删除当前行" }).click();
    await expect(page.locator(ALL_LINE_COLORS)).toHaveCount(0);

    // 给第 1 行上红，再 Alt+↓ 把它与第 2 行交换 → 红色应跟到第 2 行
    const palette2 = await openPalette(page, 0);
    await palette2.getByRole("button", { name: "红" }).click();
    await page.keyboard.press("Alt+ArrowDown");
    await expect(lineColor(page, 0)).toHaveCount(0);
    await expectColor(page, 1, RED);
  });

  test("Ctrl+D 删除有色行，Ctrl+Z 还原后颜色应还在", async ({ page }) => {
    const palette = await openPalette(page, 1);
    await palette.getByRole("button", { name: "红" }).click();
    await expectColor(page, 1, RED);

    // Ctrl+D 走 applyEdit（进浏览器撤销栈），删掉第 2 行
    await caretTo(page, 1, 0);
    await page.keyboard.press("Control+d");
    await expect(editor(page)).toHaveValue("甲\n丙");
    await expect(page.locator(ALL_LINE_COLORS)).toHaveCount(0);

    // 撤销把正文恢复，颜色按 structural 的快照一起回来
    await page.keyboard.press("Control+z");
    await expect(editor(page)).toHaveValue(LINES.join("\n"));
    await expectColor(page, 1, RED, "撤销后第 2 行应重新出现红色细线");
  });

  test("在有色行上方插入新行，下方各行的颜色应留在原行", async ({ page }) => {
    const palette1 = await openPalette(page, 1);
    await palette1.getByRole("button", { name: "红" }).click();
    const palette2 = await openPalette(page, 2);
    await palette2.getByRole("button", { name: "蓝" }).click();
    await expectColor(page, 1, RED);
    await expectColor(page, 2, BLUE);

    // 第 2 行行首回车：新空行插在它上面，原「乙」「丙」整体下推一行
    await caretTo(page, 1, 0);
    await page.keyboard.press("Enter");
    await expect(editor(page)).toHaveValue("甲\n\n乙\n丙");

    // 新行无色；红/蓝仍贴着原来的内容，各下移一行
    await expect(lineColor(page, 1)).toHaveCount(0);
    await expectColor(page, 2, RED, "红色应仍在「乙」这一行");
    await expectColor(page, 3, BLUE, "蓝色应仍在「丙」这一行");
  });

  test("清除连续空行后，非空行的颜色不应错位", async ({ app, page }) => {
    const messy = ["甲", "", "", "乙", "丙"];
    await seedLines(app, page, messy);

    // 第 2 个空行上红、「乙」上蓝
    const palette1 = await openPalette(page, 2);
    await palette1.getByRole("button", { name: "红" }).click();
    const palette2 = await openPalette(page, 3);
    await palette2.getByRole("button", { name: "蓝" }).click();
    await expectColor(page, 2, RED);
    await expectColor(page, 3, BLUE);

    // 菜单第三项作用于整篇（选区无关）；连续两个空行只留一个
    await rightClickLine(page, 4);
    await page.getByRole("menuitem", { name: "清除连续空行" }).click();
    await expect(editor(page)).toHaveValue("甲\n\n乙\n丙");

    // 「乙」从 index3 挪到 index2，蓝色应跟着它走；「丙」本来无色；
    // 被压掉的那个空行的红色归到段内留下来的空行（与「留段内第一行原样」同一口径）
    await expectColor(page, 1, RED, "被压掉的空行的颜色归到留下来的那个空行");
    await expectColor(page, 2, BLUE, "蓝色应仍贴在「乙」这一行");
    await expect(lineColor(page, 3), "「丙」不该继承蓝色").toHaveCount(0);
  });

  test("折行的行：细线贴整块底部", async ({ app, page }) => {
    const long = "长".repeat(200);
    await seedLines(app, page, [long, "尾"]);
    const boxes = await mirrorBoxes(page);
    expect(boxes[0].height).toBeGreaterThan(await rowHeight(page));

    const palette = await openPalette(page, 0);
    await palette.getByRole("button", { name: "红" }).click();

    const line = lineColor(page, 0);
    await expect(line).toBeVisible();
    await expect(line).toHaveCSS("height", "1px");
    const rect = await line.boundingBox();
    if (!rect) throw new Error("取不到行颜色细线");
    expect(rect.y).toBeCloseTo(boxes[0].top + boxes[0].height, 0);
  });
});
