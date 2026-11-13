/**
 * 行颜色的全局显示开关（标题条上的「眼睛 + 底线」按钮）。
 *
 * 与「行颜色」本身分开存：颜色是按行号的界面偏好，开关只决定画不画行下细线 ——
 * 关掉不删颜色，重新打开原样回来。缺省开（升级后行为不变），两块面板共用这一颗开关。
 */
import { ref } from "vue";

const KEY = "dnote:show-line-colors";

/// 只有明确存过 "0" 才算关闭；缺省 / 坏值一律显示
export const showLineColors = ref(localStorage.getItem(KEY) !== "0");

export function setShowLineColors(next: boolean): void {
  showLineColors.value = next;
  localStorage.setItem(KEY, next ? "1" : "0");
}
