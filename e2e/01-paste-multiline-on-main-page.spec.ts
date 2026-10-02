/**
 * 主界面多行粘贴：一次粘贴进来多行文本时，应当拆成多行落在当前行下方，
 * 而不是被浏览器压成一行。
 *
 * 背景：每行是 `<input type="text">`，浏览器对单行输入框的默认粘贴会把换行丢掉
 * （`a\nb` 粘出来是 `ab`），所以必须自己接 `paste` 事件把多行拆开。
 */
import { expect, type Page } from "@playwright/test";
import {
  disposeApp,
  expectPersistedLines,
  launchApp,
  mainPage,
  pasteText,
  rowCount,
  rowTexts,
  setClipboard,
  test,
  type AppHandle,
} from "./e2e-helpers";
import { e2eLog } from "./e2e-logger";

/// 用 CRLF 构造，顺带覆盖「Windows 剪贴板给的是 CRLF」这条路径
const LINES = ["第一行", "第二行", "第三行"];

test.describe("主界面多行粘贴", () => {
  let app: AppHandle;
  let main: Page;

  test.beforeAll(async () => {
    app = await launchApp(0);
    main = await mainPage(app);
  });

  test.afterAll(async () => {
    await disposeApp(app);
  });

  test("粘贴多行文本会拆成多行", async () => {
    setClipboard(LINES.join("\r\n"));
    await pasteText(main, 0);

    const texts = await rowTexts(main);
    const count = await rowCount(main);
    e2eLog.info(`[paste] 粘贴后 ${count} 行`, texts);

    expect(texts).toEqual(LINES);
    await expectPersistedLines(app.dataDir, LINES);
  });
});
