/**
 * 光标行操作浮条：复制 / 星标 / 四档行颜色 / 删除 / 编辑器失焦。
 *
 * 浮条跟**光标行**出现（编辑器聚焦即显示），失焦 / 拖拽 / 右键菜单 / 行滚出可视区时收起；
 * 水平跟光标 x，垂直在光标所在视觉行上方或下方。指针移动不影响它的位置。
 */
import { expect, type Page } from "@playwright/test";
import {
  caretTo,
  dragLineWith,
  editorText,
  expectPersistedLines,
  mirrorBoxes,
  readClipboard,
  seedLines,
  setClipboard,
  test,
  withClipboard,
} from "./e2e-helpers";
import { e2eLog } from "./e2e-logger";

const LINES = ["第一行", "第二行", "第三行"];

const bar = (page: Page) => page.getByRole("toolbar", { name: "行操作" });
const copyButton = (page: Page) =>
  bar(page).getByRole("button", { name: "复制当前行", exact: true });
const deleteButton = (page: Page) =>
  bar(page).getByRole("button", { name: "删除当前行", exact: true });
const starButton = (page: Page) =>
  bar(page).getByRole("button", { name: "星标当前行", exact: true });
const swatch = (page: Page, name: "无色" | "红" | "绿" | "蓝") =>
  bar(page).getByRole("button", { name, exact: true });
const blurButton = (page: Page) =>
  bar(page).getByRole("button", { name: "编辑器失焦", exact: true });

/// 当前行高亮层：靠数据属性找，不依赖 class
const caretLine = (page: Page) => page.locator("[data-caret-line]");

test.describe("光标行操作浮条", () => {
  // 同文件的用例共用一个实例与数据目录，每个用例先把数据复位到已知的三行
  test.beforeEach(async ({ app, page }) => {
    await seedLines(app, page, LINES);
    // 同文件共用一个 WebView profile：行颜色开关不复位会串用例
    await page.evaluate(() => localStorage.removeItem("dnote:show-line-colors"));
    await page.reload();
  });

  test("跟着光标行出现，失焦即收；指针移动不影响它", async ({ page }) => {
    // 刚打开：没有焦点，没有浮条
    await expect(bar(page)).toHaveCount(0);

    await caretTo(page, 1, 0);
    await expect(bar(page)).toBeVisible();
    const before = await bar(page).boundingBox();
    if (!before) throw new Error("取不到浮条位置");

    // 指针在别处移动：浮条一动不动
    await page.mouse.move(300, 300);
    await page.mouse.move(120, 240);
    const after = await bar(page).boundingBox();
    expect(after?.x).toBe(before.x);
    expect(after?.y).toBe(before.y);

    // 失焦：浮条与当前行高亮一起消失
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await expect(bar(page)).toHaveCount(0);
    await expect(caretLine(page)).toHaveCount(0);
  });

  test("位置：水平跟光标 x；顶部行放下方、底部行放上方", async ({ app, page }) => {
    const long = "甲乙丙丁戊己庚辛壬癸";
    await seedLines(app, page, [long, "乙", "丙"]);

    // 光标在第 1 行行首 → 顶部行，浮条在行下方
    await caretTo(page, 0, 0);
    await expect(bar(page)).toBeVisible();
    const boxes = await mirrorBoxes(page);
    let box = await bar(page).boundingBox();
    if (!box) throw new Error("取不到浮条位置");
    expect(box.y).toBeGreaterThanOrEqual(boxes[0].top + boxes[0].height - 1);

    // 同一行内把光标往右移：浮条跟着光标 x 右移
    const xAtStart = box.x;
    await caretTo(page, 0, 9);
    await expect
      .poll(async () => (await bar(page).boundingBox())?.x ?? xAtStart)
      .toBeGreaterThan(xAtStart + 20);

    // 光标在最后一行 → 底部行，浮条在行上方
    await caretTo(page, 2, 0);
    const boxes2 = await mirrorBoxes(page);
    box = await bar(page).boundingBox();
    if (!box) throw new Error("取不到浮条位置");
    expect(box.y + box.height).toBeLessThanOrEqual(boxes2[2].top + 1);
  });

  test("八颗按钮从左到右：复制 / 星标 / 无色 / 红 / 绿 / 蓝 / 删除 / 编辑器失焦", async ({
    page,
  }) => {
    await caretTo(page, 1, 0);

    const boxes = [
      { name: "复制当前行", locator: copyButton(page) },
      { name: "星标当前行", locator: starButton(page) },
      { name: "无色", locator: swatch(page, "无色") },
      { name: "红", locator: swatch(page, "红") },
      { name: "绿", locator: swatch(page, "绿") },
      { name: "蓝", locator: swatch(page, "蓝") },
      { name: "删除当前行", locator: deleteButton(page) },
      { name: "编辑器失焦", locator: blurButton(page) },
    ];
    const xs: number[] = [];
    for (const item of boxes) {
      const box = await item.locator.boundingBox();
      if (!box) throw new Error(`取不到浮条按钮：${item.name}`);
      xs.push(box.x);
    }
    for (let index = 1; index < xs.length; index += 1) {
      expect(
        xs[index],
        `${boxes[index].name} 应排在 ${boxes[index - 1].name} 右侧`,
      ).toBeGreaterThan(xs[index - 1]);
    }
  });

  test("点「复制当前行」把这一行写进剪贴板，文档不变", async ({ page, app }) => {
    await caretTo(page, 1, 0);
    const copy = copyButton(page);

    await withClipboard(async () => {
      setClipboard("预置内容"); // 先写点别的，证明剪贴板确实被这一行覆盖了
      await copy.click();
      // 原地反馈：按钮短暂进入"已复制"态（换图标、不改尺寸），1.2s 后自动复原
      await expect(copy).toHaveAttribute("data-copy-state", "ok");
      const okColor = await copy.locator("svg").evaluate((el) => getComputedStyle(el).color);
      const [r = 0, g = 0, b = 0] = (okColor.match(/[\d.]+/g) ?? []).map(Number);
      e2eLog.info(`[line-action-bar] 复制成功图标颜色 ${okColor}`);
      expect(g, "对勾应为绿色").toBeGreaterThan(r);
      expect(g).toBeGreaterThan(b);
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
    e2eLog.info("[line-action-bar] 删除当前行之后", text);
    expect(text).toBe("第一行\n第三行");
    await expectPersistedLines(app.dataDir, ["第一行", "第三行"]);

    // 与 Ctrl+D 同一条实现路径（applyEdit），所以同样能撤销
    await page.keyboard.press("Control+z");
    expect(await editorText(page)).toBe(LINES.join("\n"));
    await expectPersistedLines(app.dataDir, LINES);
  });

  test("Esc：编辑器失焦，浮条与高亮消失", async ({ page }) => {
    await caretTo(page, 1, 0);
    await expect(bar(page)).toBeVisible();
    await expect(caretLine(page)).toHaveAttribute("data-caret-line", "1");

    await page.keyboard.press("Escape");

    await expect(bar(page)).toHaveCount(0);
    await expect(caretLine(page)).toHaveCount(0);
    expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe("TEXTAREA");
    // 文本不受影响
    expect(await editorText(page)).toBe(LINES.join("\n"));
  });

  test("浮条最右的叉号：编辑器失焦，浮条与高亮消失", async ({ page }) => {
    await caretTo(page, 1, 0);
    await expect(bar(page)).toBeVisible();
    await expect(caretLine(page)).toHaveAttribute("data-caret-line", "1");

    await blurButton(page).click();

    await expect(bar(page)).toHaveCount(0);
    await expect(caretLine(page)).toHaveCount(0);
    expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe("TEXTAREA");
    // 文本不受影响
    expect(await editorText(page)).toBe(LINES.join("\n"));
  });

  test("滚动：光标行滚出可视区时收起，滚回来再出现", async ({ app, page }) => {
    const many = Array.from({ length: 30 }, (_, index) => `第 ${index + 1} 行`);
    await seedLines(app, page, many);
    await caretTo(page, 29, 0);
    await expect(bar(page)).toBeVisible();

    // 滚到顶部：光标行不在可视区 → 浮条收起
    await page.locator('[data-panel="main"]').evaluate((el) => {
      el.scrollTop = 0;
      el.dispatchEvent(new Event("scroll"));
    });
    await expect(bar(page)).toHaveCount(0);

    // 滚回底部：光标行重新可见 → 浮条回来
    await page.locator('[data-panel="main"]').evaluate((el) => {
      el.scrollTop = el.scrollHeight;
      el.dispatchEvent(new Event("scroll"));
    });
    await expect(bar(page)).toBeVisible();
  });

  test("拖拽行时浮条收起，松手后回到光标行", async ({ page }) => {
    await caretTo(page, 0, 0);
    await expect(bar(page)).toBeVisible();

    await dragLineWith(page, 0, 2, async () => {
      await expect(bar(page)).toHaveCount(0);
    });

    await expect(bar(page)).toBeVisible();
  });
});
