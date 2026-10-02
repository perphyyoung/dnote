/**
 * 拖拽调序：按住行首悬停出现的手柄上下拖动，行序跟着指针走，松手落盘。
 *
 * 编辑语义都交给了浏览器，**拖拽是本项目唯一自研的交互**，所以它必须有自己的 e2e
 * （此前只有 vitest 覆盖了纯函数 dropIndex / moveItem，没人验证过手柄与指针这条链路）。
 *
 * 断言口径：既看界面上的行序，也核对落盘的 `dnote.txt` —— 拖拽中只改前端状态，
 * 必须在松手那一刻落盘。
 */
import { expect } from "@playwright/test";
import { dragLine, editorText, expectPersistedLines, seedLines, test } from "./e2e-helpers";
import { e2eLog } from "./e2e-logger";

const LINES = ["第一行", "第二行", "第三行"];

test.describe("拖拽调整行序", () => {
  test.beforeEach(async ({ app, page }) => {
    await seedLines(app, page, LINES);
  });

  test("按住第一行的手柄往下拖到最后", async ({ page, app }) => {
    await dragLine(page, 0, 2);

    const text = await editorText(page);
    e2eLog.info("[drag] 往下拖后的内容", text);

    expect(text).toBe("第二行\n第三行\n第一行");
    await expectPersistedLines(app.dataDir, ["第二行", "第三行", "第一行"]);
  });

  test("按住最后一行的手柄往上拖到最前", async ({ page, app }) => {
    await dragLine(page, 2, 0);

    expect(await editorText(page)).toBe("第三行\n第一行\n第二行");
    await expectPersistedLines(app.dataDir, ["第三行", "第一行", "第二行"]);
  });

  test("拖到半行以内不换位（阈值）", async ({ page, app }) => {
    // 只移动小于半行高的距离：dropIndex 四舍五入后仍落在原下标
    await dragLineWithinHalfRow(page);

    expect(await editorText(page)).toBe(LINES.join("\n"));
    await expectPersistedLines(app.dataDir, LINES);
  });
});

/// 按住第一行手柄只往下挪 10px（< 半行 14px）后松手：顺序必须原样不动
async function dragLineWithinHalfRow(page: import("@playwright/test").Page): Promise<void> {
  const handle = await page.getByRole("button", { name: "拖拽调整顺序" }).first().boundingBox();
  if (!handle) throw new Error("取不到第一行的手柄位置");
  const x = handle.x + handle.width / 2;
  const y = handle.y + handle.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + 10, { steps: 4 });
  await page.mouse.up();
}
