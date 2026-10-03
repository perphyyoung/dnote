/**
 * 设置面板：标题条右上的齿轮 → 在标题条**下方内嵌**弹出（不开独立窗口），里头是笔记正文字号。
 *
 * 两条口径：
 * - 动字号只改文字、不改行高（`ROW_H` 恒 28，对齐 cdown）—— 所以镜像与 textarea 必须**同字号**，
 *   否则折行位置不同、手柄会系统性错位。这里照 `09` 的护栏口径再核对一次
 *   「镜像总高 ≈ textarea 内容高」。
 * - 字号偏好存在 WebView 的 localStorage（与置顶同源），同一 worker 的其它 spec 共用这份
 *   profile，所以用例结束**必须复位**，否则会污染 09/10 的几何断言。
 */
import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { seedLines, test } from "./e2e-helpers";
import { e2eLog } from "./e2e-logger";

const DEFAULT_SIZE = "14px";

/// 够长到会折行：字号一变折行位置就跟着变，正是"两边必须同源"的考验
const NOTE = [
  "短行",
  "这一行足够长，会在右边界折成好几行，用来验证字号变化后折行位置仍然与镜像一致——两边只要差一点，手柄就会系统性错位",
  "",
];

const gear = (page: Page) => page.getByRole("button", { name: "设置" });
const panel = (page: Page) => page.getByRole("dialog", { name: "设置" });
const slider = (page: Page) => page.getByLabel("笔记字体大小");
const editor = (page: Page) => page.getByRole("textbox", { name: "笔记内容" });
const mirror = (page: Page) => page.locator("[data-mirror]");

test.describe("设置面板", () => {
  test.beforeEach(async ({ app, page }) => {
    await seedLines(app, page, NOTE);
  });

  // 同一 worker 的其它 spec 共用这份 WebView profile：字号留在里面会污染 09/10 的几何断言
  test.afterEach(async ({ page }) => {
    await page.evaluate(() => {
      localStorage.removeItem("dnote:font-size");
      document.documentElement.style.setProperty("--note-font-size", "14px");
    });
  });

  test("齿轮打开面板；点正文区 / Esc / 再点齿轮都能收起", async ({ page }) => {
    await expect(panel(page)).toHaveCount(0);

    await gear(page).click();
    await expect(panel(page)).toBeVisible();
    await expect(gear(page)).toHaveAttribute("aria-expanded", "true");

    await page.keyboard.press("Escape");
    await expect(panel(page)).toHaveCount(0);

    await gear(page).click();
    await expect(panel(page)).toBeVisible();
    // 标题条以下任意处 = 遮罩 → 收起（位置相对应用外壳，32px 高的标题条之下）
    await page.getByRole("application").click({ position: { x: 20, y: 60 } });
    await expect(panel(page)).toHaveCount(0);

    await gear(page).click();
    await expect(panel(page)).toBeVisible();
    await gear(page).click();
    await expect(panel(page)).toHaveCount(0);
  });

  test("改字号：正文与镜像同字号、折行仍一致，重载后记住", async ({ page }) => {
    await expect(editor(page)).toHaveCSS("font-size", DEFAULT_SIZE);

    await gear(page).click();
    await slider(page).fill("18");
    await expect(editor(page)).toHaveCSS("font-size", "18px");
    await expect(mirror(page)).toHaveCSS("font-size", "18px");

    // 折行仍要一致：字号是折行的输入之一，两边只差一点手柄就会错位
    const [mirrorH, areaH] = await Promise.all([
      mirror(page).evaluate((el) => el.scrollHeight),
      editor(page).evaluate((el) => (el as HTMLTextAreaElement).scrollHeight),
    ]);
    e2eLog.info("[settings] 18px 下镜像总高与 textarea 内容高", mirrorH, areaH);
    expect(Math.abs(mirrorH - areaH)).toBeLessThanOrEqual(1);

    await page.reload();
    await expect(editor(page)).toHaveCSS("font-size", "18px");
  });
});
