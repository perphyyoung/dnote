<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import {
  caretLine,
  caretOffset,
  deleteLine,
  insertIndexAt,
  lineRange,
  moveItem,
} from "@/features/notes/logic";
import {
  flushNow,
  registerEditor,
  setContent,
  setLines,
  useNotes,
} from "@/features/notes/useNotes";
import { log } from "@/utils/logger";

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

/** 「当前行」＝光标所在的那一行；编辑器失焦时为 null（没有焦点就没有当前行） */
const caretIndex = ref<number | null>(null);

/** 当前行右侧的行操作按钮：只在指针停在当前行上时露头 —— 鼠标指哪，就说明在看哪 */
const showRowActions = computed(
  () => drag.value === null && caretIndex.value !== null && hoverIndex.value === caretIndex.value,
);

/** 渲染用的行号（模板里不必再处理 null） */
const currentLine = computed(() => caretIndex.value ?? 0);

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

// ── 当前行（光标所在行）：高亮与右侧行操作按钮都以它为目标 ──────────────────
/**
 * 跟随光标刷新当前行。`selectionchange` 是唯一能全覆盖的信号（打字、方向键、鼠标点击、
 * 撤销 / 重做都会触发），但它触发极频繁 —— 所以只在行号真的变了、或焦点进出时才写 ref。
 */
function syncCaretLine(): void {
  const el = editor.value;
  if (!el || document.activeElement !== el) {
    caretIndex.value = null; // 失焦：没有焦点就没有「当前行」
    return;
  }
  const index = caretLine(el.value, el.selectionStart).index;
  if (caretIndex.value !== index) caretIndex.value = index;
}

/** 失焦：既落盘，也要收掉「当前行」高亮（blur 不会触发 selectionchange，得自己叫一次） */
function onBlur(): void {
  syncCaretLine();
  flushNow();
}

onMounted(() => {
  registerEditor(editor.value);
  document.addEventListener("selectionchange", syncCaretLine);
});

onUnmounted(() => {
  registerEditor(null);
  document.removeEventListener("selectionchange", syncCaretLine);
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

// ── 应用内快捷键（键位与边界见 design.md 快捷键节）────────────────────────────
// 挂在 textarea 自己的 keydown 上（元素级），不挂 document：编辑器只有一个，元素级天然
// 随组件挂载 / 卸载，既不会残留监听，也不会出现「一次按键被两个监听各处理一遍」。

/**
 * 结构性编辑之前的光标位置，只在「紧接着的这次撤销/重做」里用一次。
 * 之所以需要：Chromium 的撤销会恢复编辑前的选区，而我们的替换是「全选 + 插入」，
 * 撤销后如果不收拾，用户看到的是「文本回来了，但整篇被选中」（见 `开发经验.md`）。
 */
let preEditCaret: number | null = null;

/** 所有输入（含原生撤销 / 重做）都从这里进：更新内容，顺带修正撤销带出来的选区 */
function onInput(e: Event): void {
  const el = e.target as HTMLTextAreaElement;
  const inputType = (e as InputEvent).inputType;
  if (inputType === "historyUndo" || inputType === "historyRedo") {
    const caret = Math.min(preEditCaret ?? el.selectionStart, el.value.length);
    preEditCaret = null;
    el.setSelectionRange(caret, caret);
  } else {
    preEditCaret = null; // 用户又打字了，上一次结构性编辑的位置不再适用
  }
  setContent(el.value);
}

/**
 * Ctrl+D 删除当前行；Alt+↑/↓ 上下移动当前行。
 *
 * 判定一律用 `e.code`（物理键位），不受输入法与键盘布局影响；**输入法组字中直接放行** ——
 * 那时的按键是在选字，不是在下命令（原生键位不需要这层判断，自研键位必须判）。
 */
function onKeydown(e: KeyboardEvent): void {
  if (e.isComposing) return;
  if ((e.ctrlKey || e.metaKey) && e.code === "KeyD") {
    e.preventDefault();
    deleteCurrentLine();
    return;
  }
  if (e.altKey && (e.code === "ArrowUp" || e.code === "ArrowDown")) {
    // 已经在头 / 尾也要拦下来：免得平台把 Alt+↑↓ 当作窗口级操作
    e.preventDefault();
    moveCurrentLine(e.code === "ArrowUp" ? -1 : 1);
  }
}

/** Ctrl+D：删掉当前行 */
function deleteCurrentLine(): void {
  const el = editor.value;
  if (!el) return;
  deleteLineAt(caretLine(el.value, el.selectionStart).index);
}

/** 删掉第 index 行（Ctrl+D 与「删除当前行」按钮共用）：走 applyEdit，因此能 Ctrl+Z 撤销 */
function deleteLineAt(index: number): void {
  const el = editor.value;
  if (!el) return;
  const text = el.value;
  const from = el.selectionStart;
  const { start, end, caret } = deleteLine(text, index);
  if (start === end) return; // 空文档：没有可删的
  applyEdit(`${text.slice(0, start)}${text.slice(end)}`, caret, from);
  log.info(`[notes] 删除第 ${index + 1} 行`);
}

/**
 * 复制第 index 行的文本到剪贴板（**不改文档**）。
 * 优先异步剪贴板 API；它在权限 / 焦点不满足时会抛，于是回落到「临时选中该行 + execCommand("copy")」
 * 并把原选区还回去 —— 两条路都留着，避免环境差异变成静默失败。
 */
async function copyLineAt(index: number): Promise<void> {
  const el = editor.value;
  const text = lines.value[index];
  if (!el || text === undefined) return;
  try {
    await navigator.clipboard.writeText(text);
  } catch (e) {
    const { start, end } = lineRange(el.value, index);
    const restore = el.selectionStart;
    el.setSelectionRange(start, end);
    document.execCommand("copy");
    el.setSelectionRange(restore, restore);
    log.warn(`[notes] 剪贴板 API 不可用，已回落 execCommand：${String(e)}`);
  }
  log.info(`[notes] 已复制当前行（第 ${index + 1} 行）`);
}

/** Alt+↑/↓：与相邻行交换，光标跟着这一行走、列保持不变；已在头 / 尾则不动 */
function moveCurrentLine(delta: number): void {
  const el = editor.value;
  if (!el) return;
  const text = el.value;
  const from = el.selectionStart;
  const { index, column } = caretLine(text, from);
  const lines = text.split("\n");
  const target = index + delta;
  if (target < 0 || target >= lines.length) return;
  const next = moveItem(lines, index, target).join("\n");
  applyEdit(next, caretOffset(next, target, column), from);
  log.info(`[notes] 第 ${index + 1} 行移到了第 ${target + 1} 行`);
}

/**
 * 落地一次结构性编辑（整份文本替换）。
 *
 * 优先走 `document.execCommand("insertText")`：它把这一笔并进浏览器自己的撤销栈，于是
 * **Ctrl+Z 能把「删掉一行 / 移走一行」撤回来**；直接改 value 是进不了撤销栈的（取舍见
 * `design.md`，机制见 `开发经验.md`）。execCommand 万一不可用（返回 false）就回落为直接写。
 *
 * `from` 是编辑前光标所在的位置：撤销会连「编辑前的选区」一起恢复（而我们是全选后替换，
 * 于是撤销后整篇被选中），撤销时用它把光标放回原处并取消选区（见 `onInput`）。
 */
function applyEdit(text: string, caret: number, from: number): void {
  const el = editor.value;
  if (!el) return;
  el.setSelectionRange(0, el.value.length);
  if (!document.execCommand("insertText", false, text)) {
    el.value = text; // 先落到 DOM，保证下面设置光标时作用在新文本上
    setContent(text);
  }
  el.setSelectionRange(caret, caret);
  preEditCaret = from; // 放在最后：否则会被本次编辑自己触发的 input 清掉
  syncCaretLine(); // 程序化改光标不一定触发 selectionchange，这里补一次，当前行立刻跟上
  flushNow();
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
      <!-- 当前行（光标所在行）的高亮：随光标走，失焦即消失；比拖拽态淡一档以免看混 -->
      <div
        v-if="caretIndex !== null && drag === null"
        class="absolute inset-x-0 bg-slate-800/40"
        :data-caret-line="caretIndex"
        :style="{ top: `${PAD_TOP + caretIndex * ROW_H}px`, height: `${ROW_H}px` }"
      />
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
      <!-- 当前行右侧的行操作：绝对定位浮在文字上，不占任何布局空间；
           只在指针停在这一行时露头（鼠标指哪就说明在看哪），拖拽中藏起来免得误点 -->
      <div
        v-if="showRowActions"
        class="absolute flex items-center gap-0.5"
        :style="{ top: `${PAD_TOP + currentLine * ROW_H}px`, right: '6px', height: `${ROW_H}px` }"
      >
        <button
          type="button"
          class="pointer-events-auto flex h-5 w-5 items-center justify-center rounded bg-slate-900/80 text-slate-500 transition hover:bg-slate-700 hover:text-slate-200"
          aria-label="复制当前行"
          title="复制当前行"
          @mousedown.prevent
          @click="copyLineAt(currentLine)"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
            <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
          </svg>
        </button>
        <button
          type="button"
          class="pointer-events-auto flex h-5 w-5 items-center justify-center rounded bg-slate-900/80 text-slate-500 transition hover:bg-slate-700 hover:text-rose-300"
          aria-label="删除当前行"
          title="删除当前行 (Ctrl+D)"
          @mousedown.prevent
          @click="deleteLineAt(currentLine)"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M3 6h18" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
            <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            <line x1="10" x2="10" y1="11" y2="17" />
            <line x1="14" x2="14" y1="11" y2="17" />
          </svg>
        </button>
      </div>
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
      @input="onInput"
      @keydown="onKeydown"
      @focus="syncCaretLine"
      @blur="onBlur"
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
