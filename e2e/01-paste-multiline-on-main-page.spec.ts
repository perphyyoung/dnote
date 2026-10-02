/**
 * 主界面多行粘贴：一次粘贴进来多行文本时，应当拆成多行落在当前行下方，
 * 而不是被浏览器压成一行。
 *
 * 背景：每行是 `<input type="text">`，浏览器对单行输入框的默认粘贴会把换行丢掉
 * （`a\nb` 粘出来是 `ab`），所以必须自己接 `paste` 事件把多行拆开。
 *
 * 本文件只有一个用例，用应用启动时的空数据目录即可，不需要预置数据。
 */
import { expect } from "@playwright/test";
import {
  expectPersistedLines,
  pasteText,
  rowCount,
  rowTexts,
  setClipboard,
  test,
  withClipboard,
} from "./e2e-helpers";
import { e2eLog } from "./e2e-logger";

/// 用 CRLF 构造，顺带覆盖「Windows 剪贴板给的是 CRLF」这条路径
const LINES = ["第一行", "第二行", "第三行"];

test.describe("主界面多行粘贴", () => {
  test("粘贴多行文本会拆成多行", async ({ page, app }) => {
    // 剪贴板是整机唯一资源，与其它 worker 的剪贴板操作串行
    await withClipboard(async () => {
      setClipboard(LINES.join("\r\n"));
      await pasteText(page, 0);
    });

    const texts = await rowTexts(page);
    const count = await rowCount(page);
    e2eLog.info(`[paste] 粘贴后 ${count} 行`, texts);

    expect(texts).toEqual(LINES);
    await expectPersistedLines(app.dataDir, LINES);
  });
});
