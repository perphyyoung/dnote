<script setup lang="ts">
import { onUnmounted, ref } from "vue";
import NoteLine from "@/features/notes/NoteLine.vue";
import { dropIndex, moveItem } from "@/features/notes/logic";
import { flushNow, insertAfter, removeRow, setText, useNotes } from "@/features/notes/useNotes";

const { rows, focusKey } = useNotes();

const draggingIndex = ref<number | null>(null);

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

onUnmounted(() => document.body.classList.remove("dragging"));
</script>

<template>
  <TransitionGroup tag="ul" name="row" class="m-0 list-none p-0">
    <NoteLine
      v-for="(row, index) in rows"
      :key="row.key"
      :text="row.text"
      :focused="focusKey === row.key"
      :dragging="draggingIndex === index"
      :placeholder="rows.length === 1 ? '写点什么…' : ''"
      @update:text="(value: string) => setText(index, value)"
      @insert="insertAfter(index)"
      @remove="removeRow(index)"
      @drag-start="(payload) => onDragStart(index, payload)"
      @drag-move="onDragMove"
      @drag-end="onDragEnd"
      @blur="flushNow"
    />
  </TransitionGroup>
</template>
