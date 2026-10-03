/**
 * 标题条：左侧的应用图标，以及「整条标题条都是拖动区」这条约定。
 *
 * 判据为什么是「命中元素自己带 `data-tauri-drag-region`」而不是真去拖窗口：拖窗口由 Tauri
 * 在 Rust 侧接收鼠标消息后调系统 API 完成，页面里观测不到。能观测到的是「这个点上按命中规则
 * 落在谁身上」，而拖动判定看的就是**那个元素自己**带不带这个标记 —— 父元素（标题条）带了不算，
 * 名称没带标记时在文字上按住就拖不动（图标能拖，是因为它 `pointer-events-none` 穿透到了标题条）。
 */
import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { test } from "./e2e-helpers";

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

function centerX(box: Box): number {
  return box.x + box.width / 2;
}

function centerY(box: Box): number {
  return box.y + box.height / 2;
}

/// 该点按命中规则落在谁身上，它自己带不带拖动标记（`pointer-events:none` 的元素会被穿透）
async function isDragRegionAt(page: Page, x: number, y: number): Promise<boolean> {
  return page.evaluate(
    ({ x, y }) => {
      const el = document.elementFromPoint(x, y);
      return el !== null && el.hasAttribute("data-tauri-drag-region");
    },
    { x, y },
  );
}

test.describe("标题条", () => {
  test("左侧是应用图标，且排在名称左边", async ({ page }) => {
    const icon = page.locator("header img[src='/icon.png']");
    await expect(icon).toBeVisible();
    const box = await icon.boundingBox();
    const label = await page.getByText("dnote", { exact: true }).boundingBox();
    if (!box || !label) throw new Error("取不到标题条的图标或名称");

    // 14px 的图标不该被 flex 压小（`shrink-0`），且必须落在名称左侧
    expect(box.width).toBeGreaterThanOrEqual(12);
    expect(box.x + box.width).toBeLessThanOrEqual(label.x);
  });

  test("整条标题条都是拖动区：图标、名称、空白处按下都命中拖动标记", async ({ page }) => {
    const icon = await page.locator("header img[src='/icon.png']").boundingBox();
    const label = await page.getByText("dnote", { exact: true }).boundingBox();
    const pin = await page.getByRole("button", { name: "置顶" }).boundingBox();
    if (!icon || !label || !pin) throw new Error("取不到标题条上的元素位置");

    // 图标：它自己是 `pointer-events-none`，命中的应当是标题条
    expect(await isDragRegionAt(page, centerX(icon), centerY(icon))).toBe(true);
    // 名称：这里必须由 span 自己带标记（只靠标题条带了不算）
    expect(await isDragRegionAt(page, centerX(label), centerY(label))).toBe(true);
    // 空白处：名称与图钉之间那片，是标题条自带的拖动区
    expect(await isDragRegionAt(page, (label.x + label.width + pin.x) / 2, centerY(label))).toBe(
      true,
    );
  });
});
