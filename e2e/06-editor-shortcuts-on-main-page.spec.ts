/**
 * 应用内快捷键：Ctrl+D 删除当前行、Alt+↑/↓ 上下移动当前行。
 *
 * 键位与边界见 `design.md` 快捷键节。这里钉四件事：改文本、落盘、**光标落点**，
 * 以及最后一条 —— **Ctrl+Z 能把这一笔撤回**。最后那条是「走 `document.execCommand`
 * 保住浏览器原生撤销栈」这条实现路线的判据：哪天实现退回直接改 value，它立刻会红。
 */
import { expect } from "@playwright/test";
import {
  caretPosition,
  caretTo,
  editorText,
  expectPersistedLines,
  seedLines,
  test,
} from "./e2e-helpers";
import { e2eLog } from "./e2e-logger";

const LINES = ["第一行", "第二行", "第三行"];

test.describe("编辑器快捷键", () => {
  // 同文件的用例共用一个实例与数据目录，每个用例先把数据复位到已知的三行
  test.beforeEach(async ({ app, page }) => {
    await seedLines(app, page, LINES);
  });

  test("Ctrl+D 删除光标所在行，光标落到顶上来的那一行行首", async ({ page, app }) => {
    await caretTo(page, 1, 2); // 光标在第二行中间
    await page.keyboard.press("Control+d");

    const text = await editorText(page);
    e2eLog.info("[shortcut] Ctrl+D 之后", text);

    expect(text).toBe("第一行\n第三行");
    expect(await caretPosition(page)).toBe(4); // "第一行\n" 之后 = 第三行行首
    await expectPersistedLines(app.dataDir, ["第一行", "第三行"]);
  });

  test("Ctrl+D 在末行：删掉它并把光标收到上一行行尾", async ({ page, app }) => {
    await caretTo(page, 2, 1);
    await page.keyboard.press("Control+d");

    expect(await editorText(page)).toBe("第一行\n第二行");
    expect(await caretPosition(page)).toBe(7); // "第一行\n第二行" 的末尾
    await expectPersistedLines(app.dataDir, ["第一行", "第二行"]);
  });

  test("整篇只剩一行时 Ctrl+D 退化为清空", async ({ page, app }) => {
    await seedLines(app, page, ["只有这一行"]);
    await caretTo(page, 0, 2);
    await page.keyboard.press("Control+d");

    expect(await editorText(page)).toBe("");
    await expectPersistedLines(app.dataDir, [""]);
  });

  test("Alt+↓ / Alt+↑ 各换一行，光标跟着这一行走且列不变", async ({ page, app }) => {
    await caretTo(page, 0, 2); // 第一行第 2 列
    await page.keyboard.press("Alt+ArrowDown");

    const moved = await editorText(page);
    e2eLog.info("[shortcut] Alt+↓ 之后", moved);

    expect(moved).toBe("第二行\n第一行\n第三行");
    expect(await caretPosition(page)).toBe(6); // "第二行\n" 之后 + 2 列
    await expectPersistedLines(app.dataDir, ["第二行", "第一行", "第三行"]);

    await page.keyboard.press("Alt+ArrowUp");
    expect(await editorText(page)).toBe(LINES.join("\n"));
    expect(await caretPosition(page)).toBe(2); // 回到第一行第 2 列
  });

  test("首行 Alt+↑ / 末行 Alt+↓ 都不动", async ({ page }) => {
    await caretTo(page, 0, 1);
    await page.keyboard.press("Alt+ArrowUp");
    expect(await editorText(page)).toBe(LINES.join("\n"));

    await caretTo(page, 2, 1);
    await page.keyboard.press("Alt+ArrowDown");
    expect(await editorText(page)).toBe(LINES.join("\n"));
  });

  test("Ctrl+Z 能把 Ctrl+D 删掉的行撤回来", async ({ page, app }) => {
    await caretTo(page, 1, 0);
    await page.keyboard.press("Control+d");
    expect(await editorText(page)).toBe("第一行\n第三行");

    await page.keyboard.press("Control+z");
    expect(await editorText(page)).toBe(LINES.join("\n"));
    await expectPersistedLines(app.dataDir, LINES);
  });
});
