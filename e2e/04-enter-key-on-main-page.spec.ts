/**
 * 主界面的回车：在**光标处**断行 —— 这是「普通记事本」最核心的一条直觉，
 * 也是从「每行一个 <input>」换成单个 `<textarea>` 的直接原因。
 *
 * 三种位置各有各的语义，缺一不可：
 * - 行首回车：当前行整体下推，新空行插在**当前位置**（不是把空行挂到下面去）；
 * - 行中回车：光标后的文字跟着新行走；
 * - 行尾回车：等价于在下面加一行。
 *
 * 这些全是浏览器原生行为，用例的价值就在于钉住「编辑器必须是一个真正的多行文本域」：
 * 一旦有人把它换回单行输入框，行首那两条立刻会红。
 */
import { expect } from "@playwright/test";
import { caretTo, editorText, expectPersistedLines, seedLines, test } from "./e2e-helpers";
import { e2eLog } from "./e2e-logger";

test.describe("主界面回车断行", () => {
  // 同文件的用例共用一个实例与数据目录，每个用例先把数据复位到已知起点
  test.beforeEach(async ({ app, page }) => {
    await seedLines(app, page, ["第一行", "第二行", "第三行"]);
  });

  test("行首回车：新空行插在当前位置，原行整体下推", async ({ page, app }) => {
    await caretTo(page, 1, 0); // 第二行行首
    await page.keyboard.press("Enter");

    const text = await editorText(page);
    e2eLog.info("[enter] 行首回车后", text);

    expect(text).toBe("第一行\n\n第二行\n第三行");
    await expectPersistedLines(app.dataDir, ["第一行", "", "第二行", "第三行"]);
  });

  test("行中回车：光标后的文字跟着新行走", async ({ page, app }) => {
    await seedLines(app, page, ["abcd"]);
    await caretTo(page, 0, 2);
    await page.keyboard.press("Enter");

    expect(await editorText(page)).toBe("ab\ncd");
    await expectPersistedLines(app.dataDir, ["ab", "cd"]);
  });

  test("行尾回车：在下面加一行（末尾空行也能存住）", async ({ page, app }) => {
    await seedLines(app, page, ["第一行"]);
    await caretTo(page, 0, 3);
    await page.keyboard.press("Enter");

    expect(await editorText(page)).toBe("第一行\n");
    await expectPersistedLines(app.dataDir, ["第一行", ""]);
  });
});
