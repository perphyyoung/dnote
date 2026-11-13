/**
 * 标题条的当前行操作：定位到行后中间出现「复制 / 星标 / 行颜色 / 删除」四个入口，
 * 失焦即收；复制读**真实系统剪贴板**核对内容、文档不变；删除直接生效（不二次确认），
 * 与 `Ctrl+D` 同一条实现，可用 `Ctrl+Z` 撤回。
 *
 * 行内右侧不再有按钮；星标 / 行颜色的显示细节见 `20` / `17`。
 */
import { expect, type Page } from "@playwright/test";
import {
  caretTo,
  editorText,
  expectPersistedLines,
  readClipboard,
  seedLines,
  setClipboard,
  test,
  withClipboard,
} from "./e2e-helpers";
import { e2eLog } from "./e2e-logger";

const LINES = ["第一行", "第二行", "第三行"];

const copyButton = (page: Page) => page.getByRole("button", { name: "复制当前行", exact: true });
const deleteButton = (page: Page) => page.getByRole("button", { name: "删除当前行", exact: true });

/// 当前行高亮层：靠数据属性找，不依赖 class
const caretLine = (page: Page) => page.locator("[data-caret-line]");

test.describe("标题条行操作", () => {
  // 同文件的用例共用一个实例与数据目录，每个用例先把数据复位到已知的三行
  test.beforeEach(async ({ app, page }) => {
    await seedLines(app, page, LINES);
    // 同文件共用一个 WebView profile：行颜色开关不复位会串用例
    await page.evaluate(() => localStorage.removeItem("dnote:show-line-colors"));
    await page.reload();
  });

  test("当前行高亮跟随光标，失焦后消失", async ({ page }) => {
    await caretTo(page, 1, 0);
    await expect(caretLine(page)).toHaveAttribute("data-caret-line", "1");

    await caretTo(page, 2, 3);
    await expect(caretLine(page)).toHaveAttribute("data-caret-line", "2");

    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await expect(caretLine(page)).toHaveCount(0);
  });

  test("入口只在定位到行时出现，失焦即收", async ({ page }) => {
    // 刚打开：没有当前行，四个入口都不出现
    await expect(copyButton(page)).toHaveCount(0);
    await expect(deleteButton(page)).toHaveCount(0);

    await caretTo(page, 1, 0);
    await expect(copyButton(page)).toBeVisible();
    await expect(deleteButton(page)).toBeVisible();

    // 失焦不重建窗口，只能程序化 blur（点 header 会顺带触发别的东西）
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await expect(copyButton(page)).toHaveCount(0);
    await expect(deleteButton(page)).toHaveCount(0);
  });

  test("四颗按钮从左到右：复制 / 星标 / 行颜色 / 删除", async ({ page }) => {
    await caretTo(page, 1, 0);

    const copy = await copyButton(page).boundingBox();
    const star = await page.getByRole("button", { name: "星标当前行" }).boundingBox();
    const color = await page.getByRole("button", { name: "行颜色", exact: true }).boundingBox();
    const del = await deleteButton(page).boundingBox();
    if (!copy || !star || !color || !del) throw new Error("取不到标题条行操作按钮的位置");

    // 复制最高频放最左；删除有破坏性放最右；星标 / 行颜色按此顺序夹在中间
    expect(copy.x).toBeLessThan(star.x);
    expect(star.x).toBeLessThan(color.x);
    expect(color.x).toBeLessThan(del.x);
  });

  test("点「复制当前行」把这一行写进剪贴板，文档不变", async ({ page, app }) => {
    await caretTo(page, 1, 0);
    const copy = copyButton(page);

    await withClipboard(async () => {
      setClipboard("预置内容"); // 先写点别的，证明剪贴板确实被这一行覆盖了
      await copy.click();
      // 原地反馈：按钮短暂进入"已复制"态（换图标、不改尺寸），1.2s 后自动复原
      await expect(copy).toHaveAttribute("data-copy-state", "ok");
      // 对勾是**绿色**：判据用"绿通道高于红/蓝"，不钉具体色值（调色板与主题都可能调）
      const okColor = await copy.locator("svg").evaluate((el) => getComputedStyle(el).color);
      const [r = 0, g = 0, b = 0] = (okColor.match(/[\d.]+/g) ?? []).map(Number);
      e2eLog.info(`[header-actions] 复制成功图标颜色 ${okColor}`);
      expect(g, "对勾应为绿色").toBeGreaterThan(r);
      expect(g).toBeGreaterThan(b);
      // 剪贴板是异步写的，轮询到内容变成本行为止
      await expect.poll(() => readClipboard(), { timeout: 3_000 }).toBe("第二行");
      await expect(copy).not.toHaveAttribute("data-copy-state", "ok", { timeout: 3_000 });
    });

    expect(await editorText(page)).toBe(LINES.join("\n"));
    await expectPersistedLines(app.dataDir, LINES);
  });

  test("点「删除当前行」直接删掉这一行，且能 Ctrl+Z 撤回", async ({ page, app }) => {
    await caretTo(page, 1, 0);
    await deleteButton(page).click();

    const text = await editorText(page);
    e2eLog.info("[header-actions] 删除当前行之后", text);
    expect(text).toBe("第一行\n第三行");
    await expectPersistedLines(app.dataDir, ["第一行", "第三行"]);

    // 与 Ctrl+D 同一条实现路径（applyEdit），所以同样能撤销
    await page.keyboard.press("Control+z");
    expect(await editorText(page)).toBe(LINES.join("\n"));
    await expectPersistedLines(app.dataDir, LINES);
  });
});
