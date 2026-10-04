import { describe, expect, it } from "vitest";
import { contrastRatio, LOW_CONTRAST_THEME, matchTheme, THEMES } from "@/features/settings/themes";

/// 正文对比度下限：WCAG AAA 的 7:1。表里不手抄数字，一律现算 —— 抄了就会飘。
const FLOOR = 7;
/// 「柔灰」是**故意**压低的对比度（长时间盯屏幕最舒服），单独豁免；其余都不许低于 7:1
const LOW_FLOOR = 6.5;

describe("颜色搭配推荐", () => {
  it("每组正文对比度都够（柔灰按它自己那档门槛）", () => {
    for (const theme of THEMES) {
      const floor = theme.name === LOW_CONTRAST_THEME ? LOW_FLOOR : FLOOR;
      expect(contrastRatio(theme.fg, theme.bg), `${theme.name} 的对比度`).toBeGreaterThanOrEqual(
        floor,
      );
    }
  });

  it("刚好十组（面板是 2×5 网格，改数量要同时改网格）", () => {
    expect(THEMES.length).toBe(10);
  });

  it("名字唯一：面板与 e2e 都按名字定位", () => {
    expect(new Set(THEMES.map((theme) => theme.name)).size).toBe(THEMES.length);
  });

  it("每组都是合法颜色，且前景不等于背景", () => {
    for (const theme of THEMES) {
      expect(theme.fg).toMatch(/^#[0-9a-f]{6}$/);
      expect(theme.bg).toMatch(/^#[0-9a-f]{6}$/);
      expect(theme.fg).not.toBe(theme.bg);
    }
  });

  it("深浅都有：至少三组深底、三组浅底", () => {
    const dark = THEMES.filter(
      (theme) => contrastRatio("#ffffff", theme.bg) > contrastRatio("#000000", theme.bg),
    );
    expect(dark.length).toBeGreaterThanOrEqual(3);
    expect(THEMES.length - dark.length).toBeGreaterThanOrEqual(3);
  });

  it("matchTheme 只在两个颜色都相等时命中（两组撞色也会被这条抓到）", () => {
    for (const theme of THEMES) {
      expect(matchTheme(theme.fg, theme.bg)?.name).toBe(theme.name);
      expect(matchTheme(theme.fg, "#123456")).toBeNull();
      expect(matchTheme("#123456", theme.bg)).toBeNull();
    }
  });
});
