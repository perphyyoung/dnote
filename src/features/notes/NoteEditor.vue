<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { insertIndexAt, moveItem } from "@/features/notes/logic";
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
/** 指针离容器上下边缘多近就开始自动滚动，以及滚动速度（分母越小越快） */
const SCROLL_EDGE = 24;
const SCROLL_DAMPING = 3;

const scroller = ref<HTMLDivElement | null>(null);
const editor = ref<HTMLTextAreaElement | null>(null);
/** 指针当前停在第几行：只让这一行的手柄显形，界面保持安静 */
const hoverIndex = ref<number | null>(null);

/** 松手后落点闪一下给个「落在这儿了」的收尾 */
const droppedIndex = ref<number | null>(null);
let dropTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * 拖拽会话。**拖动期间一个字符都不改**：只按指针画幽灵行与插入线，松手那一下才真正重排并落盘。
 * 这样文字不会跳变、光标与撤销栈不受影响 —— 旧实现每次换位都重写 textarea 的值，
 * 正是「拖起来很突兀」的根因（见 `开发经验.md`）。
 */
const drag = ref<{
  originIndex: number;
  /** 抓取点在行内的偏移：幽灵行按它贴在指针下，捏哪儿就在哪儿 */
  grabOffset: number;
  /** 指针的视口 Y：自动滚动后也拿它重算落点 */
  pointerY: number;
  /** 插入位 0..行数 */
  insert: number;
  /** 幽灵行的视口左边界与宽度（开始时量一次，拖动中不会变） */
  ghostLeft: number;
  ghostWidth: number;
} | null>(null);

const editorHeight = computed(() => PAD_TOP + PAD_BOTTOM + lines.value.length * ROW_H);

/** 插入线只在真会换位时出现：插回自己的上边或下边都等于没动 */
const showInsertLine = computed(() => {
  const d = drag.value;
  return d !== null && d.insert !== d.originIndex && d.insert !== d.originIndex + 1;
});

onMounted(() => registerEditor(editor.value));

onUnmounted(() => {
  registerEditor(null);
  stopAutoScroll();
  if (dropTimer !== null) clearTimeout(dropTimer);
  document.body.classList.remove("dragging");
});

// ── 悬停：只决定哪个手柄显形 ────────────────────────────────────────────────
function onHover(e: PointerEvent): void {
  if (drag.value !== null) return; // 拖动中由被拖行自己决定显形，别让手柄跟着闪
  const el = scroller.value;
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const index = Math.floor((e.clientY - rect.top + el.scrollTop - PAD_TOP) / ROW_H);
  hoverIndex.value = index >= 0 && index < lines.value.length ? index : null;
}

// ── 拖拽调序 ────────────────────────────────────────────────────────────────
function onHandleDown(e: PointerEvent, index: number): void {
  if (e.button !== 0) return;
  const el = scroller.value;
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const rowTop = rect.top - el.scrollTop + PAD_TOP + index * ROW_H;
  // 抓住指针：拖到编辑器外也能继续收到 move / up
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  drag.value = {
    originIndex: index,
    grabOffset: Math.min(Math.max(e.clientY - rowTop, 0), ROW_H),
    pointerY: e.clientY,
    insert: index,
    ghostLeft: rect.left,
    ghostWidth: rect.width,
  };
  updateFromPointer(e.clientY);
  document.body.classList.add("dragging");
  startAutoScroll();
}

function onHandleMove(e: PointerEvent): void {
  if (drag.value === null) return;
  updateFromPointer(e.clientY);
}

function onHandleUp(): void {
  const d = drag.value;
  if (d === null) return;
  drag.value = null;
  stopAutoScroll();
  document.body.classList.remove("dragging");
  // 插回原位（自己的上边或下边）等于没动：不写盘也不闪
  if (d.insert === d.originIndex || d.insert === d.originIndex + 1) return;
  // 插入位是「移除之前」的下标：往后拖时要减一
  const to = d.insert > d.originIndex ? d.insert - 1 : d.insert;
  setLines(moveItem(lines.value, d.originIndex, to));
  flushNow();
  flashDropped(to);
}

/** 系统取消（触摸被打断等）：整段丢弃，内容一个字都不改 */
function onHandleCancel(): void {
  if (drag.value === null) return;
  drag.value = null;
  stopAutoScroll();
  document.body.classList.remove("dragging");
}

/** 指针位置 → 插入位。插入线因此永远「画在哪就插在哪」，来回拖也不会累积误差 */
function updateFromPointer(pointerY: number): void {
  const d = drag.value;
  const el = scroller.value;
  if (!d || !el) return;
  const rect = el.getBoundingClientRect();
  const listTop = rect.top - el.scrollTop + PAD_TOP;
  d.pointerY = pointerY;
  d.insert = insertIndexAt(pointerY, listTop, ROW_H, lines.value.length, d.originIndex);
}

// ── 拖到边缘自动滚动（长笔记必需，否则拖不到窗口外的行）────────────────────
let raf = 0;

function startAutoScroll(): void {
  if (raf !== 0) return;
  raf = requestAnimationFrame(autoScrollTick);
}

function stopAutoScroll(): void {
  if (raf === 0) return;
  cancelAnimationFrame(raf);
  raf = 0;
}

function autoScrollTick(): void {
  const d = drag.value;
  const el = scroller.value;
  if (!d || !el) {
    raf = 0;
    return;
  }
  const rect = el.getBoundingClientRect();
  let delta = 0;
  if (d.pointerY < rect.top + SCROLL_EDGE) {
    delta = -Math.ceil((rect.top + SCROLL_EDGE - d.pointerY) / SCROLL_DAMPING);
  } else if (d.pointerY > rect.bottom - SCROLL_EDGE) {
    delta = Math.ceil((d.pointerY - (rect.bottom - SCROLL_EDGE)) / SCROLL_DAMPING);
  }
  if (delta !== 0) {
    const before = el.scrollTop;
    el.scrollTop = before + delta;
    if (el.scrollTop !== before) updateFromPointer(d.pointerY); // 滚动后文本位置变了，落点要重算
  }
  raf = requestAnimationFrame(autoScrollTick);
}

function flashDropped(index: number): void {
  droppedIndex.value = index;
  if (dropTimer !== null) clearTimeout(dropTimer);
  dropTimer = setTimeout(() => {
    dropTimer = null;
    droppedIndex.value = null;
  }, 240);
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
      <!-- 被拿起来的那一行：原地留个低对比标记 -->
      <div
        v-if="drag"
        class="absolute inset-x-0 bg-slate-800/40"
        :style="{ top: `${PAD_TOP + drag.originIndex * ROW_H}px`, height: `${ROW_H}px` }"
      />
      <!-- 松手落点闪一下（220ms 淡出） -->
      <div
        v-if="droppedIndex !== null"
        class="drop-flash absolute inset-x-0 bg-sky-400/20"
        :style="{ top: `${PAD_TOP + droppedIndex * ROW_H}px`, height: `${ROW_H}px` }"
      />
      <!-- 插入线：画在哪就插在哪 -->
      <div
        v-if="showInsertLine"
        class="absolute bg-sky-400/70"
        :style="{
          top: `${PAD_TOP + (drag?.insert ?? 0) * ROW_H - 1}px`,
          left: `${HANDLE_W}px`,
          right: '6px',
          height: '2px',
        }"
      />
      <button
        v-for="(_, index) in lines"
        :key="index"
        type="button"
        class="pointer-events-auto absolute flex cursor-grab touch-none items-center justify-center text-slate-600 transition-opacity active:cursor-grabbing"
        :class="index === hoverIndex || index === drag?.originIndex ? 'opacity-100' : 'opacity-0'"
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
        @pointercancel="onHandleCancel"
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

  <!-- 幽灵行：正被拿着的那一行本身，跟手贴着指针（fixed 定位，不参与文本流） -->
  <div
    v-if="drag"
    class="pointer-events-none fixed z-50 flex items-center rounded bg-slate-800 shadow-lg ring-1 ring-slate-700"
    :style="{
      top: `${drag.pointerY - drag.grabOffset}px`,
      left: `${drag.ghostLeft}px`,
      width: `${drag.ghostWidth}px`,
      height: `${ROW_H}px`,
    }"
  >
    <span
      class="flex shrink-0 justify-center text-slate-500"
      :style="{ width: `${HANDLE_W + 2}px` }"
    >
      ⠿
    </span>
    <span class="min-w-0 flex-1 truncate px-1 text-sm text-slate-200">
      {{ lines[drag.originIndex] ?? "" }}
    </span>
  </div>
</template>
