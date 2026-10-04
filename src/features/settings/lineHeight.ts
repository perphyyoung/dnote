/**
 * 行高比：行高 = 字号 × 行高比。界面偏好，存 WebView 的 localStorage（与置顶、字号、底色同源；
 * `dnote.txt` 只存笔记文本）。
 *
 * 为什么它是偏好而不是代码里的常量：行高比是"读起来舒不舒服"的主观量；而它一旦能改，行高就不再
 * 是常量 —— `NoteEditor` 的 `ROW_H`（手柄高度、幽灵行、续行箭头、视觉行换算全都读它）由它派生，
 * 所以**唯一事实源就是这个值**，文档与用例都不钉死数字。
 *
 * 值域 1.0 ~ 2.0：1.0 已经相当紧（行贴着行），再小会显拥挤；2.0 很松。步进 0.1，落库前按 0.1
 * 取整，免得 `1.5000000001` 这种浮点尾巴进 localStorage。
 */
import { ref } from "vue";

/** 行高比的最小 / 最大 / 缺省值 */
export const LINE_HEIGHT_MIN = 1;
export const LINE_HEIGHT_MAX = 2;
export const LINE_HEIGHT_DEFAULT = 1.5;

/// 偏好键：与置顶、字号、底色同一命名
const KEY = "dnote:line-height";

/// 夹取到值域内并按 0.1 取整；非法值（NaN / 空）一律回落缺省
function clamp(v: number): number {
  if (!Number.isFinite(v)) return LINE_HEIGHT_DEFAULT;
  const snapped = Math.round(v * 10) / 10;
  return Math.min(LINE_HEIGHT_MAX, Math.max(LINE_HEIGHT_MIN, snapped));
}

function read(): number {
  const raw = localStorage.getItem(KEY);
  return raw === null ? LINE_HEIGHT_DEFAULT : clamp(Number(raw));
}

/** 当前行高比；只由 `setLineHeightRatio` 改 */
export const lineHeightRatio = ref(read());

/** 应用 + 记住（即时生效：`NoteEditor` 的 `ROW_H` 是 computed，会跟着重算） */
export function setLineHeightRatio(v: number): void {
  const next = clamp(v);
  if (next === lineHeightRatio.value) return;
  lineHeightRatio.value = next;
  localStorage.setItem(KEY, String(next));
}
