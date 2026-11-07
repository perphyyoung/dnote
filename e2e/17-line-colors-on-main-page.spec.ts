/**
 * 行颜色：点进某行 → 行内操作条的「行颜色」→ 色板选色 → 左侧强调条出现；
 * 可还原默认、重载记住；删掉有色行后颜色不串到下一行，Alt+↑/↓ 移动时颜色跟着行走；
 * Ctrl+D 删除后 Ctrl+Z 还原颜色回来、在有色行上方插入新行时下方颜色留在原行、
 * 清除连续空行后颜色按行号映射跟随。
 *
 * 断言只认语义：按钮用 ARIA 名、色条用 `[data-line-color]` 数据属性、颜色读计算样式（不钉 class）。
 */
import { expect, type Page } from "@playwright/test";
import { caretTo, editor, hoverRow, rightClickLine, seedLines, test } from "./e2e-helpers";

const LINES = ["甲", "乙", "丙"];
const RED = "rgb(244, 63, 94)"; // #f43f5e
const BLUE = "rgb(14, 165, 233)"; // #0ea5e9

test.describe("行颜色", () => {
  test.beforeEach(async ({ app, page }) => {
    await seedLines(app, page, LINES);
    // 同文件共用一个 WebView profile：颜色偏好不复位会串用例
    await page.evaluate(() => localStorage.removeItem("dnote:line-colors:main"));
    await page.reload();
  });

  /// 把指针放到第 index 行并打开色板
  async function openPalette(page: Page, index: number) {
    await caretTo(page, index, 0);
    await hoverRow(page, index);
    await page.getByRole("button", { name: "行颜色" }).click();
    return page.getByRole("dialog", { name: "行颜色" });
  }

  test("选红 → 左侧强调条出现；重载仍记住；选默认还原", async ({ page }) => {
    const palette = await openPalette(page, 1);
    await expect(palette).toBeVisible();
    await palette.getByRole("button", { name: "红" }).click();

    const bar = page.locator('[data-line-color="1"]');
    await expect(bar).toBeVisible();
    await expect(bar).toHaveCSS("border-left-color", RED);
    await expect(page.locator("[data-line-color]")).toHaveCount(1); // 只给这一行上色

    await page.reload();
    await expect(page.locator('[data-line-color="1"]')).toHaveCSS("border-left-color", RED);

    const again = await openPalette(page, 1);
    await again.getByRole("button", { name: "默认" }).click();
    await expect(page.locator("[data-line-color]")).toHaveCount(0);
  });

  test("删掉有色行不串到下一行；Alt+↓ 移动时颜色跟着行走", async ({ page }) => {
    const palette = await openPalette(page, 1);
    await palette.getByRole("button", { name: "蓝" }).click();
    await expect(page.locator('[data-line-color="1"]')).toHaveCSS("border-left-color", BLUE);

    // 行内「删除当前行」：删掉第 2 行后，原来的第 3 行顶上来但不该继承蓝色
    await hoverRow(page, 1);
    await page.getByRole("button", { name: "删除当前行" }).click();
    await expect(page.locator("[data-line-color]")).toHaveCount(0);

    // 给第 1 行上红，再 Alt+↓ 把它与第 2 行交换 → 红色应跟到第 2 行
    const palette2 = await openPalette(page, 0);
    await palette2.getByRole("button", { name: "红" }).click();
    await page.keyboard.press("Alt+ArrowDown");
    await expect(page.locator('[data-line-color="0"]')).toHaveCount(0);
    await expect(page.locator('[data-line-color="1"]')).toHaveCSS("border-left-color", RED);
  });

  test("Ctrl+D 删除有色行，Ctrl+Z 还原后颜色应还在", async ({ page }) => {
    const palette = await openPalette(page, 1);
    await palette.getByRole("button", { name: "红" }).click();
    await expect(page.locator('[data-line-color="1"]')).toHaveCSS("border-left-color", RED);

    // Ctrl+D 走 applyEdit（进浏览器撤销栈），删掉第 2 行
    await caretTo(page, 1, 0);
    await page.keyboard.press("Control+d");
    await expect(editor(page)).toHaveValue("甲\n丙");
    await expect(page.locator("[data-line-color]")).toHaveCount(0);

    // 撤销把正文恢复，颜色按 structural 的快照一起回来
    await page.keyboard.press("Control+z");
    await expect(editor(page)).toHaveValue(LINES.join("\n"));
    await expect(page.locator('[data-line-color="1"]'), "撤销后第 2 行的红色应恢复").toHaveCSS(
      "border-left-color",
      RED,
    );
  });

  test("在有色行上方插入新行，下方各行的颜色应留在原行", async ({ page }) => {
    const palette1 = await openPalette(page, 1);
    await palette1.getByRole("button", { name: "红" }).click();
    const palette2 = await openPalette(page, 2);
    await palette2.getByRole("button", { name: "蓝" }).click();
    await expect(page.locator('[data-line-color="1"]')).toHaveCSS("border-left-color", RED);
    await expect(page.locator('[data-line-color="2"]')).toHaveCSS("border-left-color", BLUE);

    // 第 2 行行首回车：新空行插在它上面，原「乙」「丙」整体下推一行
    await caretTo(page, 1, 0);
    await page.keyboard.press("Enter");
    await expect(editor(page)).toHaveValue("甲\n\n乙\n丙");

    // 新行无色；红/蓝仍贴着原来的内容，各下移一行
    await expect(page.locator('[data-line-color="1"]')).toHaveCount(0);
    await expect(page.locator('[data-line-color="2"]'), "红色应仍在「乙」这一行").toHaveCSS(
      "border-left-color",
      RED,
    );
    await expect(page.locator('[data-line-color="3"]'), "蓝色应仍在「丙」这一行").toHaveCSS(
      "border-left-color",
      BLUE,
    );
  });

  test("清除连续空行后，非空行的颜色不应错位", async ({ app, page }) => {
    const messy = ["甲", "", "", "乙", "丙"];
    await seedLines(app, page, messy);

    // 第 2 个空行上红、「乙」上蓝
    const palette1 = await openPalette(page, 2);
    await palette1.getByRole("button", { name: "红" }).click();
    const palette2 = await openPalette(page, 3);
    await palette2.getByRole("button", { name: "蓝" }).click();
    await expect(page.locator('[data-line-color="2"]')).toHaveCSS("border-left-color", RED);
    await expect(page.locator('[data-line-color="3"]')).toHaveCSS("border-left-color", BLUE);

    // 菜单第三项作用于整篇（选区无关）；连续两个空行只留一个
    await rightClickLine(page, 4);
    await page.getByRole("menuitem", { name: "清除连续空行" }).click();
    await expect(editor(page)).toHaveValue("甲\n\n乙\n丙");

    // 「乙」从 index3 挪到 index2，蓝色应跟着它走；「丙」本来无色；
    // 被压掉的那个空行的红色归到段内留下来的空行（与「留段内第一行原样」同一口径）
    await expect(
      page.locator('[data-line-color="1"]'),
      "被压掉的空行的颜色归到留下来的那个空行",
    ).toHaveCSS("border-left-color", RED);
    await expect(page.locator('[data-line-color="2"]'), "蓝色应仍贴在「乙」这一行").toHaveCSS(
      "border-left-color",
      BLUE,
    );
    await expect(page.locator('[data-line-color="3"]'), "「丙」不该继承蓝色").toHaveCount(0);
  });
});
