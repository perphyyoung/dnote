/**
 * 主界面置顶切换：右上角图钉按钮切换主窗口是否置顶。
 *
 * 口径：默认置顶（窗口配置），用户取消后记在 localStorage，下次启动按它恢复。
 * 偏好存在 WebView profile 的 localStorage 里（属于「界面偏好」，不进 dnote.txt），
 * 所以每个用例先清掉它再重载，才能从「默认置顶」这个真实起点开始。
 */
import { expect } from "@playwright/test";
import { clearPinPreference, pinButton, readPinPreference, test } from "./e2e-helpers";
import { e2eLog } from "./e2e-logger";

test.describe("主界面置顶切换", () => {
  test.beforeEach(async ({ page }) => {
    await clearPinPreference(page);
    await page.reload();
    await expect(pinButton(page)).toBeVisible();
  });

  // 同一 worker 里的其它 spec 共用这份 WebView profile，别把「取消置顶」留在里面
  test.afterEach(async ({ page }) => {
    await clearPinPreference(page);
  });

  test("未存过偏好时默认置顶", async ({ page }) => {
    await expect(pinButton(page)).toHaveAttribute("aria-pressed", "true");
    expect(await readPinPreference(page)).toBeNull();
  });

  test("取消置顶会写入偏好，重载后仍是取消状态", async ({ page }) => {
    await pinButton(page).click();
    await expect(pinButton(page)).toHaveAttribute("aria-pressed", "false");
    expect(await readPinPreference(page)).toBe("0");
    e2eLog.info("[pin] 已取消置顶，偏好已写入 localStorage");

    // 重载 = 重跑前端初始化（onMounted 读偏好并恢复窗口状态），等价于下次启动的那段路径
    await page.reload();
    await expect(pinButton(page)).toHaveAttribute("aria-pressed", "false");
  });

  test("再点一次恢复置顶", async ({ page }) => {
    await pinButton(page).click();
    await expect(pinButton(page)).toHaveAttribute("aria-pressed", "false");

    await pinButton(page).click();
    await expect(pinButton(page)).toHaveAttribute("aria-pressed", "true");
    expect(await readPinPreference(page)).toBe("1");
  });
});
