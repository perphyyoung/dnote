/**
 * 主界面多行选择与复制：按住鼠标从一行拖到另一行选中整个行区间，Ctrl+C 复制成多行文本。
 *
 * 与 01 互补：01 管「粘贴进来多行」，本文件管「把多行复制出去」——两者共用同一套行模型，
 * 所以复制出来的文本必须能原样再粘回去。
 *
 * 断言口径：不只看界面上高亮了几行，还要读**系统剪贴板**核对内容
 * （只改 UI 不写剪贴板的实现会在这里露馅）。
 */
import { expect, type Page } from "@playwright/test";
import {
  dragRows,
  readClipboard,
  rowInputs,
  seedLines,
  selectedRows,
  test,
  withClipboard,
} from "./e2e-helpers";
import { e2eLog } from "./e2e-logger";

/// 预置三行：这样「选前两行」这种非全覆盖的断言才有区分度
const LINES = ["第一行", "第二行", "第三行"];

/// 剪贴板里的换行在 Windows 上可能是 CRLF，统一后再比较
function normalizeClipboard(text: string): string {
  return text.replace(/\r\n/g, "\n");
}

/// 按 Ctrl+C 并读回剪贴板内容。剪贴板是整机唯一资源，整段（含按键）都要在锁内，
/// 否则别的 worker 可能在这两步之间插进来写剪贴板。
function copyAndRead(page: Page): Promise<string> {
  return withClipboard(async () => {
    await page.keyboard.press("Control+C");
    return normalizeClipboard(readClipboard());
  });
}

test.describe("主界面多行选择与复制", () => {
  // 同文件的用例共用一个应用实例与数据目录，每个用例先把数据复位到已知的三行
  // （seedLines 会 reload，顺带清掉上一用例残留的行选区）
  test.beforeEach(async ({ app, page }) => {
    await seedLines(app, page, LINES);
  });

  test("拖选前两行后 Ctrl+C 复制出两行文本", async ({ page }) => {
    await dragRows(page, 0, 1);
    await expect(selectedRows(page)).toHaveCount(2);

    const text = await copyAndRead(page);
    e2eLog.info("[copy] 剪贴板内容", text);
    expect(text).toBe("第一行\n第二行");
  });

  test("从下往上拖选得到同样的区间", async ({ page }) => {
    await dragRows(page, 2, 0);
    await expect(selectedRows(page)).toHaveCount(3);

    expect(await copyAndRead(page)).toBe("第一行\n第二行\n第三行");
  });

  test("点击某一行会清掉选区", async ({ page }) => {
    await dragRows(page, 0, 2);
    await expect(selectedRows(page)).toHaveCount(3);

    await rowInputs(page).nth(1).click();
    await expect(selectedRows(page)).toHaveCount(0);
  });
});
