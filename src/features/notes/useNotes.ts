// 行数组是全部数据的唯一事实源：编辑、插入、删除、拖拽都在前端本地完成，
// 改动后整文件重写落盘（后端 save_notes，原子写）。
//
// 模块级单例状态（抄 cdown useCountdown 的模式）：App.vue 与 NotesPanel.vue
// 调的是同一个 useNotes()，拿到的是同一份 rows / focusKey。

import { computed, nextTick, ref } from "vue";
import { commands } from "@/bindings";
import { log } from "@/utils/logger";

/** 一行笔记的前端表示。key 只服务 Vue 列表复用与重排动画，不落盘。 */
export type NoteRow = { key: string; text: string };

/** 连续输入停顿多久后落盘；一次性动作（插入/删除/拖拽/失焦）走 flushNow 立即写 */
const SAVE_DEBOUNCE_MS = 400;

let seq = 0;

function makeRow(text = ""): NoteRow {
  seq += 1;
  return { key: `row-${seq}`, text };
}

/** 永远至少有一行，保证窗口里总有地方可以输入 */
const rows = ref<NoteRow[]>([makeRow()]);
const ready = ref(false);
const error = ref<string | null>(null);
/** 需要聚焦的行 key；NoteLine 监听自己是否被选中 */
const focusKey = ref<string | null>(null);

/**
 * 行选区：`anchor` 是按下的那一行，`focus` 是当前拖到的行（闭区间）。
 * 行是一次多行复制的单位 —— 单行内的文字选择仍走浏览器原生行为，两者互不干扰。
 */
const selection = ref<{ anchor: number; focus: number } | null>(null);

/** 规范化后的选区 `[start, end]`（闭区间，含两端）；没有选区时为 null */
const selectionRange = computed<[number, number] | null>(() => {
  const sel = selection.value;
  if (sel === null) return null;
  return [Math.min(sel.anchor, sel.focus), Math.max(sel.anchor, sel.focus)];
});

/** 建立 / 更新行选区 */
export function selectRows(anchor: number, focus: number): void {
  selection.value = { anchor, focus };
}

/** 清空行选区（点到别处、结构变动、按 Esc 时调用） */
export function clearSelection(): void {
  if (selection.value !== null) selection.value = null;
}

// ── 落盘 ────────────────────────────────────────────────────────────────────
// 用 promise 链串行化写入：调用按入队顺序执行，且执行时才取当前 rows，
// 因此最后一次入队的写入一定是最新内容（不会出现旧内容后到、覆盖新内容）。
let chain: Promise<void> = Promise.resolve();
let timer: ReturnType<typeof setTimeout> | null = null;

function flush(): Promise<void> {
  chain = chain.then(async () => {
    try {
      await commands.saveNotes(rows.value.map((r) => r.text));
      error.value = null;
    } catch (e) {
      error.value = String(e);
      log.error("[notes] 保存失败", e);
    }
  });
  return chain;
}

/** 防抖落盘：连续打字只写一次（纯文本编辑走这里） */
function scheduleSave(): void {
  if (timer !== null) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void flush();
  }, SAVE_DEBOUNCE_MS);
}

/** 立即落盘并取消挂起的防抖（插入/删除/拖拽/失焦走这里） */
export function flushNow(): void {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  void flush();
}

// ── 读取 ────────────────────────────────────────────────────────────────────
async function load(): Promise<void> {
  try {
    const lines = await commands.loadNotes();
    // 空文件（一行都没有）也给一行空行，窗口才不是死的
    rows.value = lines.length > 0 ? lines.map((t) => makeRow(t)) : [makeRow()];
    error.value = null;
  } catch (e) {
    error.value = String(e);
    log.error("[notes] 读取失败", e);
  } finally {
    ready.value = true;
  }
}

// ── 焦点 ────────────────────────────────────────────────────────────────────
/** 先清空再赋值：保证「同一个 key 再次聚焦」也能触发 NoteLine 的 watch。 */
function focusRow(key: string): void {
  focusKey.value = null;
  void nextTick(() => {
    focusKey.value = key;
  });
}

// ── 结构操作（一次性动作，立即落盘）────────────────────────────────────────
/** 在 index 行下方插入空行并聚焦它（回车） */
export function insertAfter(index: number): void {
  const row = makeRow();
  rows.value.splice(index + 1, 0, row);
  focusRow(row.key);
  clearSelection();
  flushNow();
}

/** 末尾追加空行并聚焦它（header 的「＋」） */
function appendRow(): void {
  const row = makeRow();
  rows.value.push(row);
  focusRow(row.key);
  clearSelection();
  flushNow();
}

/** 删除 index 行并聚焦上一行；只剩一行时改为清空，保证永远有地方输入 */
export function removeRow(index: number): void {
  if (index < 0 || index >= rows.value.length) return;
  if (rows.value.length <= 1) {
    rows.value[0].text = "";
    focusRow(rows.value[0].key);
  } else {
    rows.value.splice(index, 1);
    const target = rows.value[Math.min(index, rows.value.length - 1)];
    focusRow(target.key);
  }
  clearSelection();
  flushNow();
}

/**
 * 多行粘贴：`lines[0]` 落在 index 行上，其余依次插到它下面。
 * 光标前后的合并由 `logic.pasteLines` 完成，这里只负责落到行数组。
 */
export function pasteRows(index: number, lines: string[]): void {
  const row = rows.value[index];
  if (!row || lines.length === 0) return;
  row.text = lines[0];
  const inserted = lines.slice(1).map((text) => makeRow(text));
  rows.value.splice(index + 1, 0, ...inserted);
  clearSelection();
  flushNow();
}

/** 文本编辑：防抖落盘 */
export function setText(index: number, text: string): void {
  const row = rows.value[index];
  if (!row || row.text === text) return;
  row.text = text;
  scheduleSave();
}

// 单窗口应用：模块加载即读取一次，不挂生命周期钩子
void load();

export function useNotes() {
  return {
    rows,
    ready,
    error,
    focusKey,
    selectionRange,
    selectRows,
    clearSelection,
    appendRow,
    insertAfter,
    removeRow,
    setText,
  };
}
