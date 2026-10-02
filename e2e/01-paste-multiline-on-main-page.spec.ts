/**
 * 主界面多行粘贴：一次粘贴进来多行文本时，应当原样按行落下，而不是被压成一行。
 *
 * 现在编辑器是一个 `<textarea>`，多行粘贴是**浏览器原生行为**（在旧的「每行一个 <input>」
 * 模型下必须自己接管 `paste`：单行输入框会把换行压平）。本文件因此变成一条回归保护：
 * 谁要是把编辑器换回单行输入框，这里立刻会红。
 *
 * 断言口径：不只看界面上的文本，还核对**落盘的 dnote.txt**。
 */
import { expect } from "@playwright/test";
import {
  caretTo,
  editor,
  editorText,
  expectPersistedLines,
  pasteAt,
  seedLines,
  setClipboard,
  test,
  withClipboard,
} from "./e2e-helpers";
import { e2eLog } from "./e2e-logger";

/// 用 CRLF 构造，顺带覆盖「Windows 剪贴板给的是 CRLF」这条路径
const LINES = ["第一行", "第二行", "第三行"];

test.describe("主界面多行粘贴", () => {
  // 同文件的用例共用一个实例与数据目录，每个用例先把数据复位到已知起点
  test.beforeEach(async ({ app, page }) => {
    await seedLines(app, page, []);
  });

  test("粘贴多行文本会原样落下", async ({ page, app }) => {
    // 剪贴板是整机唯一资源，与其它 worker 的剪贴板操作串行
    await withClipboard(async () => {
      setClipboard(LINES.join("\r\n"));
      await pasteAt(page, 0);
    });

    const text = await editorText(page);
    e2eLog.info("[paste] 粘贴后的内容", text);

    expect(text).toBe(LINES.join("\n"));
    await expectPersistedLines(app.dataDir, LINES);
  });

  test("在行中间粘贴会就地拆开，光标前后各归其位", async ({ page, app }) => {
    await seedLines(app, page, ["ab"]);

    await withClipboard(async () => {
      setClipboard("X\r\nY");
      await editor(page).click();
      await caretTo(page, 0, 1); // 光标落在 a 与 b 之间
      await page.keyboard.press("Control+V");
    });

    expect(await editorText(page)).toBe("aX\nYb");
    await expectPersistedLines(app.dataDir, ["aX", "Yb"]);
  });
});
