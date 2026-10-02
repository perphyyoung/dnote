/**
 * 当前行的行内操作：高亮跟随光标，右侧「复制当前行 / 删除当前行」按钮浮在这一行上
 * （绝对定位，不占布局空间），且**只在指针停在这一行时**露头。
 *
 * 断言口径：按钮用 ARIA 名定位；高亮层用 `data-caret-line` 数据属性（不是 class）；
 * 复制要读**真实系统剪贴板**核对内容，并确认文档没被改动。
 */
import { expect, type Page } from "@playwright/test";
import {
  caretTo,
  editorText,
  expectPersistedLines,
  hoverRow,
  readClipboard,
  seedLines,
  setClipboard,
  test,
  withClipboard,
} from "./e2e-helpers";
import { e2eLog } from "./e2e-logger";

const LINES = ["第一行", "第二行", "第三行"];

/// 当前行高亮层（靠数据属性找，不依赖 class）
function caretLine(page: Page) {
  return page.locator("[data-caret-line]");
}

test.describe("当前行的行内操作", () => {
  // 同文件的用例共用一个实例与数据目录，每个用例先把数据复位到已知的三行
  test.beforeEach(async ({ app, page }) => {
    await seedLines(app, page, LINES);
  });

  test("高亮跟随光标，失焦后消失", async ({ page }) => {
    await caretTo(page, 1, 0);
    await expect(caretLine(page)).toHaveAttribute("data-caret-line", "1");

    await caretTo(page, 2, 3);
    await expect(caretLine(page)).toHaveAttribute("data-caret-line", "2");

    // 失焦不重建窗口，只能程序化 blur（点 header 会顺带触发别的东西）
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await expect(caretLine(page)).toHaveCount(0);
  });

  test("按钮只在指针停在这一行时出现", async ({ page }) => {
    await caretTo(page, 1, 0);
    await hoverRow(page, 1);
    await expect(page.getByRole("button", { name: "复制当前行" })).toBeVisible();
    await expect(page.getByRole("button", { name: "删除当前行" })).toBeVisible();

    // 指针停在别的行：按钮收起来（它们属于「当前行」，不是指针所在行）
    await hoverRow(page, 0);
    await expect(page.getByRole("button", { name: "删除当前行" })).toHaveCount(0);
  });

  test("点「删除当前行」删掉这一行，且能 Ctrl+Z 撤回", async ({ page, app }) => {
    await caretTo(page, 1, 0);
    await hoverRow(page, 1);
    await page.getByRole("button", { name: "删除当前行" }).click();

    const text = await editorText(page);
    e2eLog.info("[row-actions] 删除当前行之后", text);
    expect(text).toBe("第一行\n第三行");
    await expectPersistedLines(app.dataDir, ["第一行", "第三行"]);

    // 与 Ctrl+D 同一条实现路径（applyEdit），所以同样能撤销
    await page.keyboard.press("Control+z");
    expect(await editorText(page)).toBe(LINES.join("\n"));
    await expectPersistedLines(app.dataDir, LINES);
  });

  test("点「复制当前行」把这一行写进剪贴板，文档不变", async ({ page, app }) => {
    await caretTo(page, 1, 0);
    await hoverRow(page, 1);

    await withClipboard(async () => {
      setClipboard("预置内容"); // 先写点别的，证明剪贴板确实被这一行覆盖了
      await page.getByRole("button", { name: "复制当前行" }).click();
      // 剪贴板是异步写的，轮询到内容变成本行为止
      await expect.poll(() => readClipboard(), { timeout: 3_000 }).toBe("第二行");
    });

    expect(await editorText(page)).toBe(LINES.join("\n"));
    await expectPersistedLines(app.dataDir, LINES);
  });
});
