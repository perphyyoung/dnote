/**
 * 星标：光标行浮条里的入口只在定位到行时出现、失焦即收；
 * 星标常显在左侧槽（与拖拽手柄同槽，悬停该行时让位给手柄）；
 * 行号变化（回车 / 删除 / Alt+↑↓ / 拖拽）时星标跟着行走，删除后 Ctrl+Z 能还原。
 *
 * 断言只认语义：入口用 ARIA 名与 `aria-pressed`，星标用 `[data-line-star]` 数据属性。
 */
import { expect, type Page } from "@playwright/test";
import { caretTo, dragLine, editor, hoverRow, lineHandles, seedLines, test } from "./e2e-helpers";

const LINES = ["甲", "乙", "丙"];
const starAt = (page: Page, index: number) => page.locator(`[data-line-star="${index}"]`);
const starButton = (page: Page) => page.getByRole("button", { name: "星标当前行" });

test.describe("星标", () => {
  test.beforeEach(async ({ app, page }) => {
    await seedLines(app, page, LINES);
    // 同文件共用一个 WebView profile：星标偏好不复位会串用例
    await page.evaluate(() => {
      localStorage.removeItem("dnote:line-stars:main");
    });
    await page.reload();
  });

  test("入口只在定位到行时出现，失焦即收", async ({ page }) => {
    // 刚打开：没有当前行，入口不出现
    await expect(starButton(page)).toHaveCount(0);

    await caretTo(page, 1, 0);
    await expect(starButton(page)).toBeVisible();

    // 失焦：入口收起（星标本身不受影响，见下一条用例）
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await expect(starButton(page)).toHaveCount(0);
  });

  test("加星 / 取消：左槽出现黄色 ★，悬停时让位给手柄，重载仍记住", async ({ page }) => {
    await caretTo(page, 1, 0);
    await starButton(page).click();
    await expect(starButton(page)).toHaveAttribute("aria-pressed", "true");

    const star = starAt(page, 1);
    await expect(star).toHaveCount(1);
    await expect(star).toHaveCSS("color", "rgb(234, 179, 8)"); // #eab308

    // 悬停该行：星标让位给手柄（同一格，同一套显形规则）
    await hoverRow(page, 1);
    await expect(star).toHaveCSS("opacity", "0");
    await expect(lineHandles(page).nth(1)).toHaveCSS("opacity", "1");

    // 重载：星标常显（没有焦点也画），标题条入口则收起
    await page.reload();
    await expect(starAt(page, 1)).toHaveCount(1);
    await expect(starButton(page)).toHaveCount(0);

    // 再定位到这一行 → 取消星标
    await caretTo(page, 1, 0);
    await expect(starButton(page)).toHaveAttribute("aria-pressed", "true");
    await starButton(page).click();
    await expect(starAt(page, 1)).toHaveCount(0);
  });

  test("行首回车：星标跟着原来的内容下移一行", async ({ page }) => {
    await caretTo(page, 1, 0);
    await starButton(page).click();
    await expect(starAt(page, 1)).toHaveCount(1);

    await page.keyboard.press("Enter"); // 在「乙」前插入空行
    await expect(editor(page)).toHaveValue("甲\n\n乙\n丙");
    await expect(starAt(page, 1)).toHaveCount(0);
    await expect(starAt(page, 2), "星标应仍在「乙」这一行").toHaveCount(1);
  });

  test("Ctrl+D 删除带星标的行后，Ctrl+Z 还原星标", async ({ page }) => {
    await caretTo(page, 1, 0);
    await starButton(page).click();
    await expect(starAt(page, 1)).toHaveCount(1);

    await page.keyboard.press("Control+d");
    await expect(editor(page)).toHaveValue("甲\n丙");
    await expect(page.locator("[data-line-star]")).toHaveCount(0);

    await page.keyboard.press("Control+z");
    await expect(editor(page)).toHaveValue(LINES.join("\n"));
    await expect(starAt(page, 1), "撤销后星标应回到「乙」").toHaveCount(1);
  });

  test("拖拽整行：星标跟着被拖的那一行走", async ({ page }) => {
    await caretTo(page, 1, 0);
    await starButton(page).click();
    await expect(starAt(page, 1)).toHaveCount(1);

    await dragLine(page, 1, 0);
    await expect(editor(page)).toHaveValue("乙\n甲\n丙");
    await expect(starAt(page, 1)).toHaveCount(0);
    await expect(starAt(page, 0), "星标应跟到「乙」的新位置").toHaveCount(1);
  });
});
