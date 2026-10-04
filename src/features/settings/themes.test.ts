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
      const ratio = contrastRatio(theme.fg, theme.bg);
      // 消息里带上实测值：不达标时一眼看出差多少，好评估是调色还是放宽门槛
      expect(ratio, `${theme.name} 的对比度 ${ratio.toFixed(1)}:1`).toBeGreaterThanOrEqual(floor);
    }
  });

  it("刚好二十组（面板是单列可滚动列表，改数量不必动布局）", () => {
    expect(THEMES.length).toBe(20);
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

  it("前 10 档深色、后 10 档浅色（列表里就是深色一段、浅色一段）", () => {
    const isDark = (bg: string) => contrastRatio("#ffffff", bg) > contrastRatio("#000000", bg);
    expect(THEMES.slice(0, 10).every((theme) => isDark(theme.bg))).toBe(true);
    expect(THEMES.slice(10).every((theme) => !isDark(theme.bg))).toBe(true);
  });

  it("matchTheme 只在两个颜色都相等时命中（两组撞色也会被这条抓到）", () => {
    for (const theme of THEMES) {
      expect(matchTheme(theme.fg, theme.bg)?.name).toBe(theme.name);
      expect(matchTheme(theme.fg, "#123456")).toBeNull();
      expect(matchTheme("#123456", theme.bg)).toBeNull();
    }
  });
});
