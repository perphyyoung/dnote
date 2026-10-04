/**
 * 设置面板：标题条右上的齿轮 → 在标题条**下方内嵌**弹出（不开独立窗口），里头是笔记正文字号、
 * 行高比与笔记区底色。
 *
 * 两条口径：
 * - 字号与行高比**一起**决定行高（`ROW_H` = 字号 × 行高比，缺省在 `features/settings/lineHeight.ts`）
 *   —— 所以镜像与 textarea 必须**同字号**，否则折行位置不同、手柄会系统性错位。这里照 `09` 的护栏
 *   口径再核对一次「镜像总高 ≈ textarea 内容高」；行高与两者的关系各有用例盯着，且都不断言绝对值。
 * - 五个偏好（字号 / 行高比 / 前景颜色 / 背景颜色 / 开机自启）都存在 WebView 的 localStorage
 *   （与置顶同源），「颜色搭配推荐」不是第六个偏好：它只是**批量写前景与背景**，当前选中项是算出来的。
 *   同一 worker 的其它 spec 共用这份
 *   profile，所以用例结束**必须复位**，否则会污染 09/10 的几何断言。
 */
import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { rowHeight, seedLines, test } from "./e2e-helpers";
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
      localStorage.removeItem("dnote:background-color");
      document.documentElement.style.setProperty("--note-bg", "#0f172a");
      localStorage.removeItem("dnote:autostart");
      localStorage.removeItem("dnote:line-height");
      localStorage.removeItem("dnote:foreground-color");
      document.documentElement.style.setProperty("--note-fg", "#e2e8f0");
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

  test("改底色：即时生效、重载后记住、可重置", async ({ page }) => {
    const shell = page.getByRole("application");
    await expect(shell).toHaveCSS("background-color", "rgb(15, 23, 42)"); // #0f172a

    await gear(page).click();
    await page.getByLabel("背景颜色").fill("#123456");
    // 即时生效：不重载就已经变了（原生取色器弹窗点不动，所以直接设值 + 触发 input）
    await expect(shell).toHaveCSS("background-color", "rgb(18, 52, 86)");

    await page.reload();
    await expect(shell).toHaveCSS("background-color", "rgb(18, 52, 86)"); // localStorage 记住了

    await gear(page).click();
    await page.getByRole("button", { name: "重置背景颜色" }).click();
    await expect(shell).toHaveCSS("background-color", "rgb(15, 23, 42)");
    await expect(page.getByRole("button", { name: "重置背景颜色" })).toHaveCount(0); // 已回默认 → 按钮收起
  });

  test("改前景：正文与镜像同源、左槽标记跟随、重载后记住、可重置", async ({ page, app }) => {
    // 长行要真折起来，才有续行箭头可比 —— "标记跟不跟前景"正是浅色搭配最容易翻车的地方
    await seedLines(app, page, ["基准行", "折行判定要用实测几何，".repeat(12), ""]);

    const editorColor = () => editor(page).evaluate((el) => getComputedStyle(el).color);
    const mirrorColor = () => mirror(page).evaluate((el) => getComputedStyle(el).color);

    expect(await editorColor()).toBe("rgb(226, 232, 240)"); // #e2e8f0（默认）
    expect(await mirrorColor()).toBe(await editorColor()); // 两边必须同源

    await gear(page).click();
    await page.getByLabel("前景颜色", { exact: true }).fill("#cbd5e1");
    // 即时生效：不重载就已经变了（原生取色器弹窗点不动，所以直接设值 + 触发 input）
    expect(await editorColor()).toBe("rgb(203, 213, 225)");
    expect(await mirrorColor()).toBe("rgb(203, 213, 225)");
    // 左槽的续行箭头与正文同色：它要是写死 slate-200，浅色搭配下会直接看不见
    await expect(page.locator("[data-continuation-arrow]").first()).toHaveCSS(
      "color",
      "rgb(203, 213, 225)",
    );

    await page.reload();
    expect(await editorColor()).toBe("rgb(203, 213, 225)"); // localStorage 记住了

    await gear(page).click();
    await page.getByRole("button", { name: "重置前景颜色" }).click();
    expect(await editorColor()).toBe("rgb(226, 232, 240)");
    await expect(page.getByRole("button", { name: "重置前景颜色" })).toHaveCount(0); // 已回默认 → 收起
  });

  test("颜色搭配推荐：下拉选一档同时改前景与背景，偏离后回到「自定义」，重载后记住", async ({
    page,
  }) => {
    const shell = page.getByRole("application");
    const editorColor = () => editor(page).evaluate((el) => getComputedStyle(el).color);
    const picker = page.getByLabel("颜色搭配推荐");

    await gear(page).click();
    await expect(picker).toHaveValue("墨蓝"); // 默认那档就是当前值

    // 每个选项用**它自己那套颜色**渲染：名字 + 该组的字色 / 底色，展开就能一眼看出每档长什么样
    const mung = page.locator('option[value="豆沙绿"]');
    await expect(mung).toHaveCSS("color", "rgb(43, 58, 47)"); // #2b3a2f
    await expect(mung).toHaveCSS("background-color", "rgb(199, 237, 204)"); // #c7edcc

    await picker.selectOption("豆沙绿");
    // 一个动作写两个偏好：前景与背景同时变
    expect(await editorColor()).toBe("rgb(43, 58, 47)");
    await expect(shell).toHaveCSS("background-color", "rgb(199, 237, 204)");
    await expect(picker).toHaveValue("豆沙绿");

    // 只改背景 → 不再等于任何一档 → 选中项回到「自定义」，前景没被动过
    // `exact`：默认是子串匹配，会把旁边的「重置背景颜色」也匹配上（strict mode 会直接报冲突）
    await page.getByLabel("背景颜色", { exact: true }).fill("#123456");
    await expect(picker).toHaveValue("");
    await expect(page.locator('option[value=""]')).toHaveText("自定义");
    expect(await editorColor()).toBe("rgb(43, 58, 47)");

    // 重载后两个颜色都还在：存下来的是**两个颜色偏好**，不是"当前搭配"
    await page.reload();
    await expect(shell).toHaveCSS("background-color", "rgb(18, 52, 86)");
    expect(await editorColor()).toBe("rgb(43, 58, 47)");
    await gear(page).click();
    await expect(picker).toHaveValue("");
  });

  test("浅色搭配下左槽标记仍看得见：续行箭头与底色的对比度 ≥ 3:1", async ({ page, app }) => {
    await seedLines(app, page, ["基准行", "折行判定要用实测几何，".repeat(12), ""]);

    await gear(page).click();
    await page.getByLabel("颜色搭配推荐").selectOption("冷白");

    // 页内按 WCAG 相对亮度现算箭头与笔记区底色的对比度：箭头若还写死 slate-200，
    // 在这套浅色搭配下会变成"白字白底"，这条立刻红。
    const ratio = await page.evaluate(() => {
      const arrow = document.querySelector("[data-continuation-arrow]");
      const shell = document.querySelector('[role="application"]');
      if (!arrow || !shell) return -1;
      const rgb = (color: string) =>
        (color.match(/[\d.]+/g) ?? []).slice(0, 3).map((value) => Number(value) / 255);
      const luminance = (color: string) => {
        const [r = 0, g = 0, b = 0] = rgb(color).map((value) =>
          value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
        );
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      const fg = luminance(getComputedStyle(arrow).color);
      const bg = luminance(getComputedStyle(shell).backgroundColor);
      return (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
    });
    e2eLog.info("[contrast]", JSON.stringify({ ratio }));
    expect(ratio).toBeGreaterThanOrEqual(3);
  });

  // 这里只验「偏好 → 界面」这条链路：e2e 跑的是 dev 构建 + 无人值守，后端**不写注册表**
  //（见 `commands/autostart.rs`），所以机器状态不会被测试改到，判据也因此是确定的。
  test("开机自启：默认开，关掉后记住，再打开也记住", async ({ page }) => {
    const toggle = () => page.getByRole("switch", { name: "开机自启" });

    await gear(page).click();
    await expect(toggle()).toHaveAttribute("aria-checked", "true"); // 缺省 = 开

    await toggle().click();
    await expect(toggle()).toHaveAttribute("aria-checked", "false");
    expect(await page.evaluate(() => localStorage.getItem("dnote:autostart"))).toBe("0");

    await page.reload();
    await gear(page).click();
    await expect(toggle()).toHaveAttribute("aria-checked", "false");

    await toggle().click();
    await expect(toggle()).toHaveAttribute("aria-checked", "true");
    expect(await page.evaluate(() => localStorage.getItem("dnote:autostart"))).toBe("1");
  });

  test("行高跟随字号按比例变化", async ({ page }) => {
    const atDefault = await rowHeight(page);

    await gear(page).click();
    await slider(page).fill("20");
    const atLarge = await rowHeight(page);

    // 不写死比例（那是 `NoteEditor.vue` 的调节点，谁都可以改）：只要求"跟着字号走、且近似成正比"，
    // 取整带来的误差留 5% 余量。
    expect(atLarge).toBeGreaterThan(atDefault);
    expect(Math.abs(atLarge / atDefault - 20 / 14)).toBeLessThan(0.05);
  });

  test("改行高比后：续行箭头仍逐个落在真实续行上（不出现幽灵箭头）", async ({ page, app }) => {
    // 现象：行高比一改，`boxes`（镜像行盒缓存）还是**旧行高**下测的，而 `rowSpan` 已经用**新行高** ——
    // 拿旧盒高除新行高会凭空算出折行，于是每个逻辑行都长出一个 `↳`，一串假换行符挂在正文下面。
    //
    // 判据不钉任何数字：**现场重测一次镜像**（绕开 app 那份缓存）算出每个逻辑行占几个视觉行、
    // 每个续行该落在哪，再与实际渲染的箭头逐一比对 —— 少一个、多一个、错位都红。
    // 夹具换成**真的会折行**的长行：否则等号两边都是空集，用例等于白过。
    await seedLines(app, page, ["基准行", "折行判定要用实测几何，".repeat(12), ""]);

    /// 读一次当前几何，返回「应有的箭头位置（相对镜像）」与「实际箭头位置（相对镜像）」
    const arrowPositions = async () => {
      const mirrorTop = await mirror(page).evaluate((el) => el.getBoundingClientRect().top);
      const boxes = await mirror(page).evaluate((el) => {
        const base = el.getBoundingClientRect().top;
        return Array.from(el.children, (child) => {
          const rect = child.getBoundingClientRect();
          return { top: rect.top - base, height: rect.height };
        });
      });
      // 第一个夹具行不折行 → 它的行盒高就是当前行高
      const rowH = boxes[0].height;
      const expected = boxes.flatMap((b) => {
        const rows = Math.max(1, Math.round(b.height / rowH));
        return Array.from({ length: rows - 1 }, (_, k) => b.top + (k + 1) * rowH);
      });
      // 箭头在**视口坐标**里，行盒是**相对镜像**的 —— 用同一个 base 换算，否则会差一个「镜像上沿」
      const actual = await page
        .locator("[data-continuation-arrow]")
        .evaluateAll(
          (els, base) => els.map((el) => el.getBoundingClientRect().top - base),
          mirrorTop,
        );
      return { rowH, expected, actual };
    };

    await gear(page).click();
    // 两个方向都试：压到最小（旧盒 > 新行高，会算出假折行）与放到最大（旧盒 < 新行高）
    for (const ratio of ["1", "2"]) {
      await page.getByLabel("笔记行高比").fill(ratio);
      const { rowH, expected, actual } = await arrowPositions();
      e2eLog.info("[arrow]", JSON.stringify({ ratio, rowH, expected, actual }));
      expect(expected.length).toBeGreaterThan(0); // 前提：长行确实折了，这条才有意义
      expect(actual.length).toBe(expected.length);
      actual.forEach((top, i) => expect(Math.abs(top - expected[i])).toBeLessThanOrEqual(1));
    }
  });

  test("行高比：拖滑块即时改变行高，与字号同构（无重置），重载后记住", async ({ page }) => {
    const atDefault = await rowHeight(page);

    await gear(page).click();
    const slider = page.getByLabel("笔记行高比");
    await slider.fill("2");
    expect(await rowHeight(page)).toBeGreaterThan(atDefault); // 即时生效

    // 与「字体大小」同构：这一行**没有**「重置」按钮（同组控件做法一致，见 design.md「设置面板」）
    await expect(page.getByRole("button", { name: "重置行高比" })).toHaveCount(0);

    // 偏好落盘：重载后停在同一个行高上。断的是「行高没变」而不是某个绝对值 ——
    // 缺省行高比是代码里的调节点，钉死数字会让人改比例时先红一遍。
    await slider.fill("1.2");
    const before = await rowHeight(page);
    await page.reload();
    await gear(page).click();
    await expect(page.getByLabel("笔记行高比")).toHaveValue("1.2");
    expect(await rowHeight(page)).toBe(before);
  });

  test("面板最底下一行显示版本号", async ({ page }) => {
    await gear(page).click();

    // 断言两件事：版本号是 semver 形态（构建期由 vite 注入，写错会渲染成别的字符串），
    // 且「版本号」这一行是面板里的最后一行（左标签 + 右信息，与上面几行同构）
    await expect(panel(page).getByText(/^v\d+\.\d+\.\d+$/)).toBeVisible();
    const labels = await panel(page).locator("p").allInnerTexts();
    expect(labels.at(-1)).toBe("版本号");
  });
});
