/**
 * 带标记复制 / 粘贴：应用内复制把行颜色与星标一起带走；外部只拿纯文字。
 *
 * 断言只认语义：颜色看 `[data-line-color-underline]` 的内联样式、星标看
 * `[data-line-star]`，剪贴板文字走 `expectClipboardText()`（PowerShell 真读系统剪贴板）。
 * 所有剪切板动作包在 `withClipboard` 内。
 */
import { expect, type Page } from "@playwright/test";
import {
  LINE_BLUE,
  LINE_RED,
  caretTo,
  editor,
  expectClipboardText,
  seedLines,
  setClipboard,
  test,
  withClipboard,
} from "./e2e-helpers";

const LINES = ["甲", "乙", "丙"];
const ALL_LINES = "[data-line-color-underline]";

const lineColor = (page: Page, index: number) =>
  page.locator(`[data-line-color-underline="${index}"]`);
const lineStar = (page: Page, index: number) => page.locator(`[data-line-star="${index}"]`);

async function expectColor(page: Page, index: number, color: string) {
  const line = lineColor(page, index);
  await expect(line).toHaveCount(1);
  expect(await line.getAttribute("style")).toContain(color);
}

/// 定位到某行后直接点浮条里的四档颜色
async function paint(page: Page, index: number, name: "无色" | "红" | "绿" | "蓝") {
  await caretTo(page, index, 0);
  await page.getByRole("button", { name, exact: true }).click();
}

/// 定位到某行后从浮条里加星标
async function star(page: Page, index: number) {
  await caretTo(page, index, 0);
  await page.getByRole("button", { name: "星标当前行" }).click();
}

test.describe("带色复制粘贴", () => {
  test.beforeEach(async ({ app, page }) => {
    await seedLines(app, page, LINES);
    // 同文件共用一个 WebView profile：颜色 / 星标与显示开关都要复位
    await page.evaluate(() => {
      localStorage.removeItem("dnote:line-colors:main");
      localStorage.removeItem("dnote:line-stars:main");
      localStorage.removeItem("dnote:show-line-colors");
    });
    await page.reload();
  });

  test("Ctrl+C 带色与星标，外部只读到文字；粘贴后标记落回新行", async ({ page }) => {
    await paint(page, 0, "红");
    await star(page, 0);
    await caretTo(page, 0, 0);

    await withClipboard(async () => {
      await page.keyboard.press("Shift+ArrowDown"); // 选中「甲」+ 换行
      await page.keyboard.press("Control+c");
      await expectClipboardText("甲\n");

      await page.keyboard.press("Control+End");
      await page.keyboard.press("Enter");
      await page.keyboard.press("Control+v");
      // 粘贴是异步读剪贴板：等值落定再出锁
      await expect(editor(page)).toHaveValue("甲\n乙\n丙\n甲\n");
    });

    await expectColor(page, 3, LINE_RED);
    await expect(lineStar(page, 3), "星标应随文字一起粘到新行").toHaveCount(1);
  });

  test("浮条「复制当前行」也带颜色与星标", async ({ page }) => {
    await paint(page, 1, "蓝");
    await star(page, 1);

    await withClipboard(async () => {
      await page.getByRole("button", { name: "复制当前行" }).click();
      await expectClipboardText("乙");
      await editor(page).click();
      await page.keyboard.press("Control+End");
      await page.keyboard.press("Enter");
      await page.keyboard.press("Control+v");
      await expect(editor(page)).toHaveValue("甲\n乙\n丙\n乙");
    });

    await expectColor(page, 3, LINE_BLUE);
    await expect(lineStar(page, 3), "星标应随文字一起粘到新行").toHaveCount(1);
  });

  test("外部来源粘贴只贴文字，不套标记；行中粘贴也不套标记", async ({ page }) => {
    await paint(page, 0, "红");
    await star(page, 0);

    await withClipboard(async () => {
      setClipboard("外部\n");
      await editor(page).click();
      await page.keyboard.press("Control+Home");
      await page.keyboard.press("Control+v");
      await expect(editor(page)).toHaveValue("外部\n甲\n乙\n丙");
    });
    await expect(page.locator(ALL_LINES)).toHaveCount(1); // 只有原来那一行红色
    await expect(page.locator("[data-line-star]")).toHaveCount(1); // 也只有原来那一颗星

    // 复制带标记的「甲」行，粘贴到「丙」行中间：文字进、标记不进
    await caretTo(page, 1, 0);
    await withClipboard(async () => {
      await page.keyboard.press("Shift+ArrowDown");
      await page.keyboard.press("Control+c");
      await expectClipboardText("甲\n");
      await caretTo(page, 4, 1);
      await page.keyboard.press("Control+v");
      await expect(editor(page)).toHaveValue("外部\n甲\n乙\n丙甲\n");
    });
    await expect(page.locator(ALL_LINES)).toHaveCount(1);
    await expect(page.locator("[data-line-star]")).toHaveCount(1);
  });

  test("带标记粘贴后 Ctrl+Z：文字和标记一起回", async ({ page }) => {
    await paint(page, 0, "红");
    await star(page, 0);
    await caretTo(page, 0, 0);

    await withClipboard(async () => {
      await page.keyboard.press("Shift+ArrowDown");
      await page.keyboard.press("Control+c");
      await expectClipboardText("甲\n");
      await page.keyboard.press("Control+End");
      await page.keyboard.press("Enter");
      await page.keyboard.press("Control+v");
      await expect(editor(page)).toHaveValue("甲\n乙\n丙\n甲\n");
    });
    await expectColor(page, 3, LINE_RED);
    await expect(lineStar(page, 3)).toHaveCount(1);

    await page.keyboard.press("Control+z");
    await expect(editor(page)).toHaveValue("甲\n乙\n丙\n");
    await expect(page.locator(ALL_LINES)).toHaveCount(1);
    await expect(lineStar(page, 3)).toHaveCount(0);
    await expect(lineStar(page, 0)).toHaveCount(1);
  });
});
