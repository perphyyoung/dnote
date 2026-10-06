/**
 * 帮助面板：标题条上那颗 `?`（图钉左侧）→ 在标题条**下方内嵌**弹出（不开独立窗口），
 * 内容是**最上方的版本号** + 两列快捷键表格 + 「与普通笔记应用的区别」清单。
 *
 * 四条口径：
 * - 与设置面板**互斥**、共用一层遮罩：不存在"两个都开着"（`overlay` 一个 ref 说了算），
 *   点另一个入口直接换过去；三条收起路径（点遮罩 / 点标题条 / `Esc`）对两个浮层一样。
 * - 贴窗口右缘（`right-2`，与设置面板同一条），且面板够宽 —— `?` 必然落在它的水平范围内。
 * - **键位清单在这里是第三处**（监听在 `NoteEditor.vue` / `App.vue`、`title` 在各入口按钮上）：
 *   这里逐条断言清单里出现的键位（顺序也钉住）—— 改键位漏改帮助面板就会红。`Esc`（收浮层）
 *   属通用习惯、不必记，**不上榜**（口径见 design.md「快捷键」节）。
 * - **文案两条硬约束**（都靠本文件盯）：书面语、**一条一行不折行** —— 默认窗宽 360 下逐条量
 *   行高，折了行就红。本文件不动窗口尺寸，所以「手动拖窄窗口导致的折行」不在断言范围内。
 */
import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { test } from "./e2e-helpers";

const helpButton = (page: Page) => page.getByRole("button", { name: "帮助" });
const helpPanel = (page: Page) => page.getByRole("dialog", { name: "帮助" });
const settingsButton = (page: Page) => page.getByRole("button", { name: "设置" });
const settingsPanel = (page: Page) => page.getByRole("dialog", { name: "设置" });

/// 快捷键表格里逐行出现的键位，顺序也要一致 —— `Alt+↑ / Alt+↓` 是同一行
const KEYS = ["Ctrl+D", "Alt+↑ / Alt+↓", "Alt+S", "Ctrl+Alt+N"];

test.describe("帮助面板", () => {
  test.beforeEach(async ({ page }) => {
    // 浮层是**页面级**状态、跨用例留着（同一 spec 文件共用一个页面）—— `Esc` 把上一条用例
    // 可能开着的浮层收掉；没开着时它是空操作。这样每条用例都从"没有浮层"起跑。
    await page.keyboard.press("Escape");
  });

  test("`?` 开关：点一下弹出、再点收起", async ({ page }) => {
    await expect(helpPanel(page)).toHaveCount(0);

    await helpButton(page).click();
    await expect(helpPanel(page)).toBeVisible();
    await expect(helpButton(page)).toHaveAttribute("aria-expanded", "true");

    await helpButton(page).click();
    await expect(helpPanel(page)).toHaveCount(0);
    await expect(helpButton(page)).toHaveAttribute("aria-expanded", "false");
  });

  test("最上面一行是版本号", async ({ page }) => {
    await helpButton(page).click();
    const panel = helpPanel(page);

    // 断言两件事：版本号是 semver 形态（构建期由 vite 注入，写错会渲染成别的字符串），
    // 且「版本号」这一行是面板里的**第一行**（左标签 + 右信息，与设置面板的其它行同构）
    await expect(panel.getByText(/^v\d+\.\d+\.\d+$/)).toBeVisible();
    const labels = await panel.locator("p").allInnerTexts();
    expect(labels[0]).toBe("版本号");
  });

  test("内容：快捷键是两列表格，键位逐条都在、说明列对齐，且一条一行不折行", async ({ page }) => {
    await helpButton(page).click();
    const panel = helpPanel(page);

    // 表格形式：4 行，每行一个行头（键位）+ 一个单元格（说明）。`Alt+↑ / Alt+↓` 同一行，
    // 所以是 4 行 5 个键位；`Esc` 不在其中（它不上榜）。
    const rows = panel.getByRole("row");
    await expect(rows).toHaveCount(KEYS.length);
    const keys = await panel.getByRole("rowheader").allInnerTexts();
    expect(keys.map((text) => text.trim())).toEqual(KEYS);
    for (const row of await rows.all()) await expect(row.getByRole("cell")).not.toBeEmpty();

    // 说明列左缘对齐 —— 这就是"快捷键改成了两列表格"的可证伪判据
    const cells = await panel.getByRole("cell").all();
    const lefts: number[] = [];
    for (const cell of cells) {
      const box = await cell.boundingBox();
      if (!box) throw new Error("取不到说明单元格的位置");
      lefts.push(box.x);
    }
    for (const left of lefts) expect(Math.abs(left - lefts[0]!)).toBeLessThanOrEqual(1);

    // 文案：书面语 + 组标题；`Esc` 连说明里都不该出现
    const listed = await panel.innerText();
    expect(listed).toContain("与普通笔记应用的区别");
    expect(listed).toContain("主面板与次级面板独立存储");
    expect(listed).toContain("改动即时写入磁盘");
    expect(listed, "Esc 不该出现在帮助面板里").not.toContain("Esc");

    // 一条一行不折行：量到的行高超过 1.5 倍行距就是折了行（默认窗宽下）
    const wrapped = await panel.evaluate((el) =>
      Array.from(el.querySelectorAll("li, td"))
        .filter((item) => {
          const lineHeight = parseFloat(getComputedStyle(item).lineHeight);
          return item.getBoundingClientRect().height > lineHeight * 1.5;
        })
        .map((item) => item.textContent?.trim() ?? ""),
    );
    expect(wrapped, "帮助面板出现折行").toEqual([]);
  });

  test("互斥：切到另一个入口直接换过去，不会两个都开着", async ({ page }) => {
    await helpButton(page).click();
    await expect(helpPanel(page)).toBeVisible();

    await settingsButton(page).click();
    await expect(settingsPanel(page)).toBeVisible();
    await expect(helpPanel(page)).toHaveCount(0);

    await helpButton(page).click();
    await expect(helpPanel(page)).toBeVisible();
    await expect(settingsPanel(page)).toHaveCount(0);
  });

  test("三条收起路：点遮罩、点标题条、`Esc` 各收一次", async ({ page }) => {
    const closers: ReadonlyArray<[string, (page: Page) => Promise<void>]> = [
      [
        "遮罩",
        async (page) => {
          await page.getByRole("application").click({ position: { x: 20, y: 60 } });
        },
      ],
      [
        "标题条",
        async (page) => {
          await page.mouse.click(100, 16);
        },
      ],
      [
        "Esc",
        async (page) => {
          await page.keyboard.press("Escape");
        },
      ],
    ];

    for (const [name, close] of closers) {
      await helpButton(page).click();
      await expect(helpPanel(page), `关不掉：${name}`).toBeVisible();
      await close(page);
      await expect(helpPanel(page), `收不起：${name}`).toHaveCount(0);
    }
  });

  test("位置：贴窗口右缘 8px，且 `?` 落在面板的水平范围内", async ({ page }) => {
    await helpButton(page).click();
    const panel = await helpPanel(page).boundingBox();
    const button = await helpButton(page).boundingBox();
    const shell = await page.getByRole("application").boundingBox();
    if (!panel || !button || !shell) throw new Error("取不到帮助面板 / 按钮 / 外壳的位置");

    // 与设置面板同一条：`right-2`
    expect(shell.x + shell.width - (panel.x + panel.width)).toBeCloseTo(8, 0);
    // 图钉左侧那颗 `?` 在面板横向范围内 —— 视觉上就是"从 `?` 下面长出来"
    expect(button.x).toBeGreaterThanOrEqual(panel.x);
    expect(button.x + button.width).toBeLessThanOrEqual(panel.x + panel.width);
  });
});
