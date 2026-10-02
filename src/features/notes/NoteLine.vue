<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { pasteLines } from "@/features/notes/logic";

const props = defineProps<{
  text: string;
  /** 是否被要求聚焦（新建/插入后自动落在这一行） */
  focused: boolean;
  dragging: boolean;
  /** 是否落在行选区内（多行复制用） */
  selected: boolean;
  placeholder: string;
}>();

const emit = defineEmits<{
  (e: "update:text", value: string): void;
  (e: "insert"): void;
  (e: "remove"): void;
  (e: "paste-lines", lines: string[]): void;
  (e: "drag-start", payload: { clientY: number; rowHeight: number }): void;
  (e: "drag-move", payload: { clientY: number }): void;
  (e: "drag-end"): void;
  (e: "row-down", payload: { clientX: number; clientY: number }): void;
  (e: "blur"): void;
}>();

const rowClass = computed(() => {
  if (props.dragging) return "bg-slate-800 shadow-sm";
  if (props.selected) return "bg-sky-500/25";
  return "";
});

const input = ref<HTMLInputElement | null>(null);
const handle = ref<HTMLButtonElement | null>(null);

// 新建的行被要求聚焦：等 DOM 就绪后落焦点
watch(
  () => props.focused,
  (wanted) => {
    if (wanted) input.value?.focus();
  },
  { immediate: true, flush: "post" },
);

function onKeydown(e: KeyboardEvent) {
  // 输入法组字中的回车用于上屏，不能当成「插入新行」
  if (e.isComposing) return;
  if (e.key === "Enter") {
    e.preventDefault();
    emit("insert");
    return;
  }
  // 空行上退格 = 删除这一行；非空行交给输入框自己删字符
  if (e.key === "Backspace" && props.text === "") {
    e.preventDefault();
    emit("remove");
  }
}

// 单行输入框的默认粘贴会把换行丢掉（浏览器把整段压成一行），
// 所以多行粘贴必须自己接管：拆成多行交给上层落到行数组。
function onPaste(e: ClipboardEvent) {
  const el = input.value;
  if (!el) return;
  const text = e.clipboardData?.getData("text") ?? "";
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? start;
  const lines = pasteLines(text, el.value.slice(0, start), el.value.slice(end));
  if (!lines) return; // 单行粘贴仍走浏览器默认行为
  e.preventDefault();
  emit("paste-lines", lines);
}

// 行长按：行选区的起点。拖拽手柄自己处理 pointerdown，不参与选区。
function onRowDown(e: PointerEvent) {
  if (e.button !== 0) return;
  if (handle.value && e.target instanceof Node && handle.value.contains(e.target)) return;
  emit("row-down", { clientX: e.clientX, clientY: e.clientY });
}

function onHandleDown(e: PointerEvent) {
  if (e.button !== 0) return;
  const el = handle.value;
  const row = el?.closest("li");
  if (!el || !(row instanceof HTMLElement)) return;
  // 抓住指针：拖到列表外也能继续收到 move / up
  el.setPointerCapture(e.pointerId);
  emit("drag-start", {
    clientY: e.clientY,
    // 行高统一，用被拖行的实测高度换算位移（不硬编码，换字号也不会错位）
    rowHeight: row.getBoundingClientRect().height,
  });
}

function onHandleMove(e: PointerEvent) {
  emit("drag-move", { clientY: e.clientY });
}
</script>

<template>
  <li
    class="group flex items-center rounded"
    :class="rowClass"
    role="option"
    :aria-selected="selected"
    @pointerdown="onRowDown"
  >
    <button
      ref="handle"
      type="button"
      class="flex h-6 w-4 shrink-0 cursor-grab touch-none items-center justify-center text-slate-600 opacity-0 transition group-hover:opacity-100 active:cursor-grabbing"
      aria-label="拖拽调整顺序"
      @mousedown.prevent
      @pointerdown="onHandleDown"
      @pointermove="onHandleMove"
      @pointerup="emit('drag-end')"
      @pointercancel="emit('drag-end')"
    >
      ⠿
    </button>
    <input
      ref="input"
      class="h-7 min-w-0 flex-1 border-0 bg-transparent px-1 text-sm text-slate-200 outline-none placeholder:text-slate-600"
      type="text"
      aria-label="笔记内容"
      :placeholder="placeholder"
      :value="text"
      @input="emit('update:text', ($event.target as HTMLInputElement).value)"
      @keydown="onKeydown"
      @paste="onPaste"
      @blur="emit('blur')"
    />
    <button
      type="button"
      class="h-6 w-5 shrink-0 text-slate-600 opacity-0 transition hover:text-rose-400 group-hover:opacity-100"
      aria-label="删除这一行"
      @mousedown.prevent
      @click="emit('remove')"
    >
      ×
    </button>
  </li>
</template>
