/**
 * 主界面多行选择与复制：选区跨越多行时，Ctrl+C 复制出的就是选中那段文本。
 *
 * 与 01 互补：01 管「粘贴进来多行」，本文件管「把多行复制出去」。
 * 现在编辑器是一个 `<textarea>`，多行选区是浏览器原生的（旧的「每行一个 <input>」模型做不到：
 * 输入框之间没有连续选区，只能用「整行选区」近似，也复制不了半行）。
 *
 * 断言口径：不只看界面上选了什么，还要读**系统剪贴板**核对内容
 * （只改 UI 不写剪贴板的实现会在这里露馅）。
 */
import { expect, type Page } from "@playwright/test";
import { caretTo, readClipboard, seedLines, test, withClipboard } from "./e2e-helpers";
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
  test.beforeEach(async ({ app, page }) => {
    await seedLines(app, page, LINES);
  });

  test("从第二行行首选到行尾，Ctrl+C 复制出两行", async ({ page }) => {
    await caretTo(page, 1, 0);
    await page.keyboard.press("Shift+ArrowDown"); // 选到第三行行首
    await page.keyboard.press("Shift+End"); // 再选到第三行行尾

    const text = await copyAndRead(page);
    e2eLog.info("[copy] 剪贴板内容", text);
    expect(text).toBe("第二行\n第三行");
  });

  test("从下往上选得到同样的区间", async ({ page }) => {
    await caretTo(page, 2, 3); // 光标在第三行行尾
    await page.keyboard.press("Shift+Home"); // 选到第三行行首
    await page.keyboard.press("Shift+ArrowUp"); // 再往上吃到第二行行首

    expect(await copyAndRead(page)).toBe("第二行\n第三行");
  });

  test("Ctrl+A 全选后复制的是整份内容", async ({ page }) => {
    await caretTo(page, 0, 0);
    await page.keyboard.press("Control+A");

    expect(await copyAndRead(page)).toBe(LINES.join("\n"));
  });
});
