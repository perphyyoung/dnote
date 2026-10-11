/**
 * 右键菜单：编辑器里右键 → 复制 / 删除（**自绘浮层**，系统菜单已由 `main.ts` 全局关掉）。
 *
 * 四条口径：
 * - **两项，按范围动态**：无选区是「复制当前行 / 删除当前行」，选中 N 行是「复制 N 行 / 删除 N 行」。
 * - **命中规则借原生行为**：Chromium 右键点在选区外会先把插入符挪到点击处、在选区内则保留选区 ——
 *   所以「选区外右键只作用于那一行」不必自己算几何（下面第 3 条钉着它）。
 * - **贴指针、越界朝指针那一侧翻转**（窗口无边框，越界即看不见）；夹取由纯函数 `menuPosition` 算。
 * - 删除与 `Ctrl+D` 同一条实现（`applyEdit`），所以能 `Ctrl+Z` 撤回。
 */
import fs from "node:fs";
import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import {
  caretTo,
  editorText,
  expectPersistedLines,
  notesFile,
  readClipboard,
  seedLines,
  selection,
  setClipboard,
  test,
  withClipboard,
} from "./e2e-helpers";
import { e2eLog } from "./e2e-logger";

const LINES = ["第一行", "第二行", "第三行", "第四行"];

const editor = (page: Page) => page.getByRole("textbox", { name: "笔记内容" });
const menu = (page: Page) => page.getByRole("menu", { name: "笔记操作" });
const item = (page: Page, label: string) => page.getByRole("menuitem", { name: label });

/**
 * 在第 line 行右键。
 *
 * 坐标 = 「该行手柄的竖直中点」+「文本区左侧 `dx` 像素」：**必须落在 textarea 上** ——
 * 落在左侧手柄或容器空白区上时，`contextmenu` 到不了我们的监听（也就没有菜单）。
 * 手柄只在悬停时显形，但 `opacity-0` 的元素照样有 `boundingBox`，所以不必先 hover。
 */
async function rightClickLine(page: Page, line: number, dx = 60): Promise<void> {
  const handle = await page.getByRole("button", { name: "拖拽调整顺序" }).nth(line).boundingBox();
  const box = await editor(page).boundingBox();
  if (!handle || !box) throw new Error("取不到行手柄 / 编辑器位置");
  await page.mouse.click(box.x + dx, handle.y + handle.height / 2, { button: "right" });
}

test.describe("右键菜单", () => {
  // 同文件的用例共用一个实例与数据目录，每个用例先把数据复位到已知的四行
  test.beforeEach(async ({ app, page }) => {
    await seedLines(app, page, LINES);
  });

  test("无选区右键：两项是「复制 / 删除当前行」，删除能 Ctrl+Z 撤回", async ({ page, app }) => {
    await rightClickLine(page, 1);
    await expect(menu(page)).toBeVisible();
    await expect(item(page, "复制当前行")).toBeVisible();
    await expect(item(page, "删除当前行")).toBeVisible();

    await item(page, "删除当前行").click();
    await expect(menu(page)).toHaveCount(0); // 点完就收
    expect(await editorText(page)).toBe("第一行\n第三行\n第四行");
    await expectPersistedLines(app.dataDir, ["第一行", "第三行", "第四行"]);

    await page.keyboard.press("Control+z");
    expect(await editorText(page)).toBe(LINES.join("\n"));
  });

  test("选中两行后在选区内右键：两项变成「2 行」，删除只删选中的那两行", async ({ page, app }) => {
    await caretTo(page, 0, 0);
    await page.keyboard.press("Shift+ArrowDown");
    await page.keyboard.press("Shift+End"); // 选中第 1、2 行

    await rightClickLine(page, 1); // 选区之内 → 原生保留选区
    await expect(item(page, "复制 2 行")).toBeVisible();
    await item(page, "删除 2 行").click();

    expect(await editorText(page)).toBe("第三行\n第四行");
    await expectPersistedLines(app.dataDir, ["第三行", "第四行"]);
  });

  test("在选区外右键：选区清零，只作用于点中的那一行", async ({ page, app }) => {
    await caretTo(page, 0, 0);
    await page.keyboard.press("Shift+ArrowDown");
    await page.keyboard.press("Shift+End"); // 选中第 1、2 行
    expect((await selection(page)).end).toBeGreaterThan(0);

    await rightClickLine(page, 3); // 第 4 行，在选区之外
    await expect(item(page, "删除当前行")).toBeVisible(); // 回到单行语义

    await item(page, "删除当前行").click();
    expect(await editorText(page)).toBe("第一行\n第二行\n第三行");
    const left = await selection(page);
    expect(left.end - left.start).toBe(0); // 原生已经把选区收成光标
    await expectPersistedLines(app.dataDir, ["第一行", "第二行", "第三行"]);
  });

  test("复制 N 行：剪贴板拿到整块（行间换行、不含行尾换行）", async ({ page }) => {
    await caretTo(page, 1, 0);
    await page.keyboard.press("Shift+ArrowDown");
    await page.keyboard.press("Shift+End"); // 选中第 2、3 行
    await rightClickLine(page, 2);

    // 菜单里的复制走**异步**剪贴板 API，点完不等于已经写完 —— 先放哨兵再等它被换掉，
    // 比"睡一会儿再读"确定。整段（含点击与读写）都在 `withClipboard` 锁内。
    const text = await withClipboard(async () => {
      setClipboard("哨兵");
      await item(page, "复制 2 行").click();
      const deadline = Date.now() + 3000;
      let read = readClipboard();
      while (read === "哨兵" && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        read = readClipboard();
      }
      return read.replace(/\r\n/g, "\n");
    });
    e2eLog.info("[menu] 复制 2 行的剪贴板内容", text);
    expect(text).toBe("第二行\n第三行");
  });

  test("贴指针、越界翻转：靠右缘右键时菜单仍完整落在窗口内", async ({ page }) => {
    const view = await page.evaluate(() => ({
      w: window.innerWidth,
      h: window.innerHeight,
    }));
    const box = await editor(page).boundingBox();
    if (!box) throw new Error("取不到编辑器位置");

    // 贴着右缘（`dx` = 右缘往左 20px）：菜单宽约 112px，装不下 → 必须翻到指针左侧
    const near = box.width - 20;
    await rightClickLine(page, 0, near);
    await expect(menu(page)).toBeVisible();

    const rect = await menu(page).boundingBox();
    if (!rect) throw new Error("取不到菜单位置");
    e2eLog.info("[menu] 贴右缘时的菜单矩形", JSON.stringify({ view, rect }));
    expect(rect.x + rect.width).toBeLessThanOrEqual(view.w); // 没有越过右缘
    expect(rect.x).toBeLessThan(box.x + near); // 真的翻了（而不是照旧贴指针）
  });

  test("Esc 收起菜单", async ({ page }) => {
    await rightClickLine(page, 1);
    await expect(menu(page)).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(menu(page)).toHaveCount(0);
  });

  test("点窗口别处收起菜单", async ({ page }) => {
    await rightClickLine(page, 1);
    await expect(menu(page)).toBeVisible();

    // 点标题条下方那片区域（遮罩之外的手感同款：点哪儿都收）
    await page.getByRole("application").click({ position: { x: 20, y: 60 } });
    await expect(menu(page)).toHaveCount(0);
  });

  test("滚动收起菜单（长笔记）", async ({ page, app }) => {
    // 行数够多才滚得动
    await seedLines(
      app,
      page,
      Array.from({ length: 40 }, (_, index) => `第 ${index + 1} 行`),
    );

    await rightClickLine(page, 0);
    await expect(menu(page)).toBeVisible();

    await page.mouse.wheel(0, 200);
    await expect(menu(page)).toHaveCount(0);
  });

  test("清除连续空行：永远作用于整篇（有选区也一样），且能 Ctrl+Z 撤回", async ({ page, app }) => {
    const messy = ["第一行", "", "", "", "第二行", "  ", "", ""];
    await seedLines(app, page, messy);

    // **先选中前两行**：这一项只看整篇，选区不该影响结果（下面断言连文末那段也一起清了）。
    // 按两次 `Shift+↓`：第 2 行是空行，`Shift+End` 在它上面推不动，所以只能靠方向键下移。
    await caretTo(page, 0, 0);
    await page.keyboard.press("Shift+ArrowDown");
    await page.keyboard.press("Shift+ArrowDown"); // 停在第三行行首 → 覆盖第 1、2 行

    await rightClickLine(page, 0); // 选区之内 → 菜单按选区算（顺便证明选区还在）
    await expect(item(page, "删除 2 行")).toBeVisible();
    await item(page, "清除连续空行").click();

    // 每段各留一个、留段内第一行原样：第二段留下的是那个纯空格行
    const expected = ["第一行", "", "第二行", "  "];
    expect(await editorText(page)).toBe(expected.join("\n"));
    await expectPersistedLines(app.dataDir, expected);

    await page.keyboard.press("Control+z");
    expect(await editorText(page)).toBe(messy.join("\n"));
    await expectPersistedLines(app.dataDir, messy);
  });

  test("没有连续空行时点它：文本与磁盘都一个字节不动", async ({ page, app }) => {
    await seedLines(app, page, ["第一行", "", "第二行"]);
    const before = fs.readFileSync(notesFile(app.dataDir, "main"), "utf8");

    await rightClickLine(page, 0);
    await item(page, "清除连续空行").click();

    expect(await editorText(page)).toBe("第一行\n\n第二行");
    expect(fs.readFileSync(notesFile(app.dataDir, "main"), "utf8")).toBe(before);
  });
});
