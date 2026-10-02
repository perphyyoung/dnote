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
  dataDirFor,
  disposeApp,
  dragRows,
  launchApp,
  mainPage,
  readClipboard,
  rowInputs,
  selectedRows,
  test,
  writeDataFile,
  type AppHandle,
} from "./e2e-helpers";
import { e2eLog } from "./e2e-logger";

/// 预置三行：这样「选前两行」这种非全覆盖的断言才有区分度
const LINES = ["第一行", "第二行", "第三行"];

/// 剪贴板里的换行在 Windows 上可能是 CRLF，统一后再比较
function clipboardText(): string {
  return readClipboard().replace(/\r\n/g, "\n");
}

test.describe("主界面多行选择与复制", () => {
  let app: AppHandle;
  let main: Page;

  test.beforeAll(async () => {
    // 预置数据文件后再启动，初始内容才确定（不必用 UI 造数据）
    writeDataFile(dataDirFor(0), LINES);
    app = await launchApp(0);
    main = await mainPage(app);
  });

  test.afterAll(async () => {
    await disposeApp(app);
  });

  test("拖选前两行后 Ctrl+C 复制出两行文本", async () => {
    await dragRows(main, 0, 1);
    await expect(selectedRows(main)).toHaveCount(2);

    await main.keyboard.press("Control+C");
    const text = clipboardText();
    e2eLog.info("[copy] 剪贴板内容", text);
    expect(text).toBe("第一行\n第二行");
  });

  test("从下往上拖选得到同样的区间", async () => {
    await dragRows(main, 2, 0);
    await expect(selectedRows(main)).toHaveCount(3);

    await main.keyboard.press("Control+C");
    expect(clipboardText()).toBe("第一行\n第二行\n第三行");
  });

  test("点击某一行会清掉选区", async () => {
    await dragRows(main, 0, 2);
    await expect(selectedRows(main)).toHaveCount(3);

    await rowInputs(main).nth(1).click();
    await expect(selectedRows(main)).toHaveCount(0);
  });
});
