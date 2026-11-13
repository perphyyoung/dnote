/**
 * 行颜色的色板与类型（数据与状态本体在 `lineMarks.ts`，与星标共用一套搬运逻辑）。
 *
 * 三条口径：
 * - **只改"这一行长得怎么样"，不改内容**：颜色数组按**行号**存 localStorage（与字号之类同源，
 *   不进 `dnote.txt`）。改错字不动行号 → 颜色还在；行号变了（拖拽 / 删除 / 回车）则由
 *   `lineMarks` 里的纯函数跟着搬 —— 所以颜色永远贴在"行"上，而不是贴在"第 N 个字符"上。
 * - **文字本身无法逐行上色**：编辑器是单个 `<textarea>`，做不到逐行设 `color`。所以呈现是
 *   行盒下沿的 1px 同色细线（右端渐隐），由 `NoteEditor` 按实测行盒绘制。
 * - **不进备份**：备份包只装两份笔记（纯文本），颜色是界面偏好，换机器不带。
 */

/// 色板：第一项「默认」= 没有颜色（行下不画细线）
export const LINE_COLORS = [
  { value: null, label: "默认" },
  { value: "#f43f5e", label: "红" },
  { value: "#f59e0b", label: "橙" },
  { value: "#eab308", label: "黄" },
  { value: "#10b981", label: "绿" },
  { value: "#2dd4bf", label: "青" },
  { value: "#0ea5e9", label: "蓝" },
  { value: "#818cf8", label: "靛" },
  { value: "#8b5cf6", label: "紫" },
  { value: "#f472b6", label: "粉" },
] as const;

export type LineColor = string | null;
