<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { dropIndex, moveItem } from "@/features/notes/logic";
import {
  flushNow,
  registerEditor,
  setContent,
  setLines,
  useNotes,
} from "@/features/notes/useNotes";

const { content, lines } = useNotes();

// 手柄要按行对准，所以行高与内边距不能各写各的：下面 textarea 用行内样式就是为了一处定义、
// 两处对齐（圆角块里的类名会被 Tailwind 配置牵着走，行内样式不会）。
const ROW_H = 28;
const PAD_TOP = 8;
/** 底部多留一条滚动条的高度：长行横向滚动时，别让滚动条盖住最后一行 */
const PAD_BOTTOM = 16;
const HANDLE_W = 20;

const scroller = ref<HTMLDivElement | null>(null);
const editor = ref<HTMLTextAreaElement | null>(null);
/** 指针当前停在第几行：只让这一行的手柄显形，界面保持安静 */
const hoverIndex = ref<number | null>(null);
const draggingIndex = ref<number | null>(null);

/** 高度按行数算出来（不靠内部滚动），滚动交给外层容器 —— 手柄层才能跟着一起滚 */
const editorHeight = computed(() => PAD_TOP + PAD_BOTTOM + lines.value.length * ROW_H);

onMounted(() => registerEditor(editor.value));

onUnmounted(() => {
  registerEditor(null);
  document.body.classList.remove("dragging");
});

function onHover(e: PointerEvent): void {
  if (drag !== null) return; // 拖动中行序一直在变，别让手柄跟着闪
  const el = scroller.value;
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const index = Math.floor((e.clientY - rect.top + el.scrollTop - PAD_TOP) / ROW_H);
  hoverIndex.value = index >= 0 && index < lines.value.length ? index : null;
}

// ── 拖拽调序 ────────────────────────────────────────────────────────────────
/**
 * 拖拽会话。基准（originIndex / startY）固定在按下那一刻：拖拽中内容会被实时重排，
 * 若拿「当前下标」当基准会累积误差、来回拖不可逆（纯函数 dropIndex 的基准语义，见 logic.ts）。
 */
let drag: { originIndex: number; startY: number; currentIndex: number } | null = null;

function onHandleDown(e: PointerEvent, index: number): void {
  if (e.button !== 0) return;
  // 抓住指针：拖到列表外也能继续收到 move / up
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  drag = { originIndex: index, startY: e.clientY, currentIndex: index };
  draggingIndex.value = index;
  document.body.classList.add("dragging");
}

function onHandleMove(e: PointerEvent): void {
  if (!drag) return;
  const to = dropIndex(e.clientY, drag.startY, ROW_H, drag.originIndex, lines.value.length);
  if (to === drag.currentIndex) return;
  // 本地立即重排（乐观更新）：被拖的那行跟着指针走；松手时才落盘
  setLines(moveItem(lines.value, drag.currentIndex, to));
  drag.currentIndex = to;
  draggingIndex.value = to;
}

function onHandleUp(): void {
  if (!drag) return;
  drag = null;
  draggingIndex.value = null;
  document.body.classList.remove("dragging");
  flushNow();
}
</script>

<template>
  <div
    ref="scroller"
    class="relative h-full overflow-y-auto"
    @pointermove="onHover"
    @pointerleave="hoverIndex = null"
  >
    <!-- 行手柄层：absolute 子元素随滚动容器一起移动，所以手柄天然跟文本对齐。
         整层 pointer-events:none，只有手柄自己可点 —— 别挡住 textarea 的点击与落光标。 -->
    <div
      class="pointer-events-none absolute inset-x-0 top-0"
      :style="{ height: `${editorHeight}px` }"
    >
      <!-- 拖拽中：给被拖行当前落点铺一条高亮（半透明，压在文字上方也看得清） -->
      <div
        v-if="draggingIndex !== null"
        class="absolute inset-x-0 bg-slate-800/60"
        :style="{ top: `${PAD_TOP + draggingIndex * ROW_H}px`, height: `${ROW_H}px` }"
      />
      <button
        v-for="(_, index) in lines"
        :key="index"
        type="button"
        class="pointer-events-auto absolute flex cursor-grab touch-none items-center justify-center text-slate-600 transition-opacity active:cursor-grabbing"
        :class="index === hoverIndex || index === draggingIndex ? 'opacity-100' : 'opacity-0'"
        :style="{
          top: `${PAD_TOP + index * ROW_H}px`,
          height: `${ROW_H}px`,
          width: `${HANDLE_W}px`,
        }"
        aria-label="拖拽调整顺序"
        @mousedown.prevent
        @pointerdown="onHandleDown($event, index)"
        @pointermove="onHandleMove"
        @pointerup="onHandleUp"
        @pointercancel="onHandleUp"
      >
        ⠿
      </button>
    </div>

    <!-- 无边框 textarea：编辑语义全交给浏览器 —— 回车在光标处断行（行首回车即在当前位置
         插入新行）、退格 / 删除把相邻两行合并、↑↓ 在行间移动、Ctrl+A / Ctrl+Z / 多行选区
         都是原生的。wrap="off" + whitespace-pre：不折行，一条笔记一行，手柄才按行高对得齐。 -->
    <textarea
      ref="editor"
      class="block w-full resize-none overflow-x-auto overflow-y-hidden whitespace-pre border-0 bg-transparent text-sm text-slate-200 outline-none placeholder:text-slate-600"
      :style="{
        lineHeight: `${ROW_H}px`,
        height: `${editorHeight}px`,
        padding: `${PAD_TOP}px 6px ${PAD_BOTTOM}px ${HANDLE_W + 2}px`,
      }"
      wrap="off"
      spellcheck="false"
      aria-label="笔记内容"
      placeholder="写点什么…"
      :value="content"
      @input="setContent(($event.target as HTMLTextAreaElement).value)"
      @blur="flushNow"
    />
  </div>
</template>
