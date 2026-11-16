/**
 * 浮条的全局显示开关（标题条上「?」右侧的胶囊按钮）。
 *
 * 浮条是光标行的操作入口，但光标一落到某一行就弹出来，会挡住那一行上下的文字；
 * 这个开关只决定浮条显不显示 —— 当前行高亮、快捷键与右键菜单都不受影响。
 * 缺省开（升级后行为不变），两块面板共用这一颗开关。
 */
import { ref } from "vue";

const KEY = "dnote:show-action-bar";

/// 只有明确存过 "0" 才算关闭；缺省 / 坏值一律显示
export const showActionBar = ref(localStorage.getItem(KEY) !== "0");

export function setShowActionBar(next: boolean): void {
  showActionBar.value = next;
  localStorage.setItem(KEY, next ? "1" : "0");
}
