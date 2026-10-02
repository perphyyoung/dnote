<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import NoteLine from "@/features/notes/NoteLine.vue";
import { dropIndex, moveItem, selectionText } from "@/features/notes/logic";
import {
  clearSelection,
  flushNow,
  insertAfter,
  pasteRows,
  removeRow,
  selectRows,
  setText,
  useNotes,
} from "@/features/notes/useNotes";
import { log } from "@/utils/logger";

const { rows, focusKey, selectionRange } = useNotes();

const draggingIndex = ref<number | null>(null);

/** 该行是否落在当前行选区内 */
function isSelected(index: number): boolean {
  const range = selectionRange.value;
  return range !== null && index >= range[0] && index <= range[1];
}

// ── 拖拽调序 ────────────────────────────────────────────────────────────────
/**
 * 拖拽会话。基准（originIndex / startY）固定在按下那一刻：
 * 拖拽中列表会被实时重排，若拿「当前下标」当基准会累积误差、来回拖不可逆
 * （纯函数 dropIndex 的基准语义，见 logic.ts）。
 */
let drag: {
  originIndex: number;
  startY: number;
  rowHeight: number;
  currentIndex: number;
} | null = null;

function onDragStart(index: number, payload: { clientY: number; rowHeight: number }) {
  drag = {
    originIndex: index,
    startY: payload.clientY,
    rowHeight: payload.rowHeight,
    currentIndex: index,
  };
  draggingIndex.value = index;
  clearSelection(); // 重排会打乱下标，先清掉选区
  document.body.classList.add("dragging");
}

function onDragMove(payload: { clientY: number }) {
  if (!drag) return;
  const to = dropIndex(
    payload.clientY,
    drag.startY,
    drag.rowHeight,
    drag.originIndex,
    rows.value.length,
  );
  if (to === drag.currentIndex) return;
  // 本地立即重排（乐观更新），TransitionGroup 负责让位动画；松手时才落盘
  rows.value = moveItem(rows.value, drag.currentIndex, to);
  drag.currentIndex = to;
  draggingIndex.value = to;
}

function onDragEnd() {
  if (!drag) return;
  drag = null;
  draggingIndex.value = null;
  document.body.classList.remove("dragging");
  flushNow();
}

// ── 多行选择 ────────────────────────────────────────────────────────────────
/**
 * 行选区会话。
 * - 在**同一行内**拖动不动它 —— 那是输入框的原生文字选择（单行复制靠它）；
 * - 指针一旦落到**别的行**才进入行选区模式，并主动结束输入框里的原生选择，避免两套高亮并存。
 */
let selecting: { anchor: number; startX: number; startY: number; active: boolean } | null = null;

/** 指针落在哪一行：用 li 上的 data-row-index 反查，比手算矩形稳 */
function rowIndexAt(x: number, y: number): number | null {
  const li = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-row-index]");
  if (!li) return null;
  const index = Number(li.dataset.rowIndex);
  return Number.isInteger(index) ? index : null;
}

function onRowDown(index: number, p: { clientX: number; clientY: number }) {
  selecting = { anchor: index, startX: p.clientX, startY: p.clientY, active: false };
  window.addEventListener("pointermove", onSelectMove);
  window.addEventListener("pointerup", onSelectUp, { once: true });
}

function onSelectMove(e: PointerEvent) {
  if (!selecting) return;
  const index = rowIndexAt(e.clientX, e.clientY);
  if (index === null) return;
  if (!selecting.active) {
    if (index === selecting.anchor) return; // 还在同一行 → 交给原生文字选择
    selecting.active = true;
    (document.activeElement as HTMLElement | null)?.blur?.();
  }
  selectRows(selecting.anchor, index);
}

function onSelectUp() {
  window.removeEventListener("pointermove", onSelectMove);
  // 只是点了一下、没拖到别的行：清掉旧选区，符合「点别处取消选中」的直觉
  if (selecting && !selecting.active) clearSelection();
  selecting = null;
}

// ── 多行复制 ────────────────────────────────────────────────────────────────
/// 行选区内的 Ctrl+C 自己写剪贴板（`\n` 连接）；没有选区时不接管，单行复制走浏览器默认
function onCopy(e: ClipboardEvent) {
  const range = selectionRange.value;
  if (range === null) return;
  e.preventDefault();
  const text = selectionText(
    rows.value.map((r) => r.text),
    range[0],
    range[1],
  );
  e.clipboardData?.setData("text/plain", text);
  log.info(`[notes] 已复制 ${range[1] - range[0] + 1} 行`);
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === "Escape") clearSelection();
}

onMounted(() => {
  document.addEventListener("copy", onCopy);
  document.addEventListener("keydown", onKeydown);
});

onUnmounted(() => {
  document.body.classList.remove("dragging");
  window.removeEventListener("pointermove", onSelectMove);
  document.removeEventListener("copy", onCopy);
  document.removeEventListener("keydown", onKeydown);
});
</script>

<template>
  <TransitionGroup
    tag="ul"
    name="row"
    class="m-0 list-none p-0"
    role="listbox"
    aria-label="笔记行"
    aria-multiselectable="true"
  >
    <NoteLine
      v-for="(row, index) in rows"
      :key="row.key"
      :data-row-index="index"
      :text="row.text"
      :focused="focusKey === row.key"
      :dragging="draggingIndex === index"
      :selected="isSelected(index)"
      :placeholder="rows.length === 1 ? '写点什么…' : ''"
      @update:text="(value: string) => setText(index, value)"
      @insert="insertAfter(index)"
      @remove="removeRow(index)"
      @paste-lines="(lines: string[]) => pasteRows(index, lines)"
      @row-down="(payload) => onRowDown(index, payload)"
      @drag-start="(payload) => onDragStart(index, payload)"
      @drag-move="onDragMove"
      @drag-end="onDragEnd"
      @blur="flushNow"
    />
  </TransitionGroup>
</template>
