/**
 * 笔记备份：把两块面板的笔记打包成 zip（导出）/ 从 zip 覆盖回来（导入）。
 *
 * 三条口径：
 * - 导出用的是**前端这份文本**（它才是唯一事实源），导出前先 `flushNow()`，让盘上跟着一致；
 * - 导入**不在后端落盘**：后端只解包、把两份文本返回，等界面确认后再落地（没确认一个字节都不写）；
 * - 落地优先交给编辑器（`NoteEditor.replaceAll` → `applyEdit`），主面板因此**可 Ctrl+Z 撤销**；
 *   次级面板收起时没有编辑器实例，退回 `setContent` + `flushNow`。
 */
import { commands } from "@/bindings";
import { log } from "@/utils/logger";
import { useNotes } from "./useNotes";

/// 从 zip 解出来的两份笔记（行数组，与 store 的编码一致）
export interface ImportedNotes {
  main: string[];
  secondary: string[];
}

/// 面板内容 → 导出用的行数组。空面板给**空数组**（与「文件不存在 = 空」一致）：
/// 否则会导出成 `[""]`，导入后凭空多出一个空行。
function exportLines(lines: string[]): string[] {
  return lines.length === 1 && lines[0] === "" ? [] : lines;
}

/// 导出两块面板的笔记成一个 zip；返回落盘路径，用户取消返回 null
export async function exportNotesBackup(): Promise<string | null> {
  const main = useNotes("main");
  const secondary = useNotes("secondary");
  main.flushNow();
  secondary.flushNow();
  const path = await commands.exportNotesBackup(
    exportLines(main.lines.value),
    exportLines(secondary.lines.value),
  );
  if (path !== null) log.info("[backup] 已导出", path);
  return path;
}

/// 选一个 zip 并解出两份笔记（**不落盘**）；用户取消返回 null
export async function pickNotesBackup(): Promise<ImportedNotes | null> {
  const notes = await commands.importNotesBackup();
  if (notes === null) return null;
  log.info("[backup] 待导入", notes.main.length, "行 /", notes.secondary.length, "行");
  return { main: notes.main, secondary: notes.secondary };
}
