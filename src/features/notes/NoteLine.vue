<script setup lang="ts">
import { ref, watch } from "vue";

const props = defineProps<{
  text: string;
  /** 是否被要求聚焦（新建/插入后自动落在这一行） */
  focused: boolean;
  dragging: boolean;
  placeholder: string;
}>();

const emit = defineEmits<{
  (e: "update:text", value: string): void;
  (e: "insert"): void;
  (e: "remove"): void;
  (e: "drag-start", payload: { clientY: number; rowHeight: number }): void;
  (e: "drag-move", payload: { clientY: number }): void;
  (e: "drag-end"): void;
  (e: "blur"): void;
}>();

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
  <li class="group flex items-center rounded" :class="dragging ? 'bg-slate-800 shadow-sm' : ''">
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
      :placeholder="placeholder"
      :value="text"
      @input="emit('update:text', ($event.target as HTMLInputElement).value)"
      @keydown="onKeydown"
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
