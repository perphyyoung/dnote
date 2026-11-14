<script setup lang="ts">
/**
 * 光标行的操作浮条：**复制 / 星标 / 行颜色 / 删除**。
 *
 * 由 `NoteEditor` 按**光标所在行**定位（`fixed`、视口坐标）后渲染；浮条不跟指针走，
 * 所以指针移到浮条上时它不会跑。这里只负责按钮、复制反馈与色板；星标 / 行颜色直接读写
 * `lineMarks`，复制 / 删除向父组件抛事件（那里才有文本、行标记与撤销栈）。
 *
 * 按钮一律 `mousedown.prevent`：按下不抢编辑器的焦点、也不破坏选区，光标行因此不变，
 * 浮条留在原地。
 */
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import type { Panel } from "@/features/notes/useNotes";
import { LINE_COLORS, type LineColor } from "@/features/settings/lineColors";
import { showLineColors } from "@/features/settings/lineColorsVisible";
import { useLineMarks } from "@/features/settings/lineMarks";

const props = defineProps<{
  panel: Panel;
  line: number;
  /// 复制按钮的原地反馈（由父组件按当前行绑定，换行即失效）
  copyState: "ok" | "fail" | null;
}>();
const emit = defineEmits<{
  (e: "copy"): void;
  (e: "delete"): void;
}>();

/// 面板 / 行在浮条存续期间不会变（变了父组件会重新定位），但仍按 prop 取那一份 store
const marks = computed(() => useLineMarks(props.panel));
const starred = computed(() => marks.value.starAt(props.line));
const color = computed(() => marks.value.colorAt(props.line));

function toggleStar(): void {
  closePalette();
  marks.value.setStar(props.line, !starred.value);
}

/// 其它行操作也要先把色板收掉：它挡住了当前行
function startCopy(): void {
  closePalette();
  emit("copy");
}

function startDelete(): void {
  closePalette();
  emit("delete");
}

// ── 行颜色色板：fixed 浮层，贴按钮上方 / 下方（放不下就翻边）──────────────
/// 色板尺寸（20px 按钮 × 5 列 / 2 行 + gap + padding + 边框）：只用来夹取位置
const PALETTE_W = 134;
const PALETTE_H = 62;
const paletteOpen = ref(false);
const palettePos = ref({ x: 0, y: 0 });

function togglePalette(event: MouseEvent): void {
  if (paletteOpen.value) {
    closePalette();
    return;
  }
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  const below = rect.bottom + 4 + PALETTE_H <= window.innerHeight - 8;
  palettePos.value = {
    x: Math.max(
      8,
      Math.min(rect.left + rect.width / 2 - PALETTE_W / 2, window.innerWidth - PALETTE_W - 8),
    ),
    y: below ? rect.bottom + 4 : Math.max(8, rect.top - PALETTE_H - 4),
  };
  paletteOpen.value = true;
}

function pickColor(value: LineColor): void {
  marks.value.setColor(props.line, value);
  closePalette();
}

/// 收起色板（点浮条外 / `Esc` / 选了颜色 / 换了行）
function closePalette(): void {
  paletteOpen.value = false;
}

/// 行 / 面板变了就把色板收掉：它作用的是"刚才那一行"
watch(
  () => [props.panel, props.line],
  () => {
    paletteOpen.value = false;
  },
);

/// 点浮条外任意处 / `Esc` 都收起色板（浮条根上 `pointerdown.stop`，点自己不会误收）
function onDocumentPointerDown(): void {
  closePalette();
}

function onDocumentKeydown(event: KeyboardEvent): void {
  if (event.code === "Escape") closePalette();
}

onMounted(() => {
  document.addEventListener("pointerdown", onDocumentPointerDown);
  document.addEventListener("keydown", onDocumentKeydown);
});

onUnmounted(() => {
  document.removeEventListener("pointerdown", onDocumentPointerDown);
  document.removeEventListener("keydown", onDocumentKeydown);
});
</script>

<template>
  <div
    class="fixed z-30 flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 p-1 shadow-xl"
    role="toolbar"
    aria-label="行操作"
    @pointerdown.stop
  >
    <!-- 复制当前行：成功 → 绿色对勾，失败 → 红色叉，1.2s 后自动复原。 -->
    <button
      type="button"
      class="flex h-6 w-6 items-center justify-center rounded text-slate-300 transition hover:bg-slate-700 hover:text-slate-100"
      aria-label="复制当前行"
      title="复制当前行"
      :data-copy-state="copyState ?? undefined"
      @mousedown.prevent
      @click="startCopy"
    >
      <svg
        v-if="copyState === 'ok'"
        class="text-emerald-400"
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
        <path d="M20 6 9 17l-5-5" />
      </svg>
      <svg
        v-else-if="copyState === 'fail'"
        class="text-rose-400"
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
        <path d="M18 6 6 18" />
        <path d="m6 6 12 12" />
      </svg>
      <svg
        v-else
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

    <!-- 星标：黄色是唯一形态；再点一次取消。 -->
    <button
      type="button"
      class="flex h-6 w-6 items-center justify-center rounded transition hover:bg-slate-700"
      :class="starred ? 'text-slate-100' : 'text-slate-300'"
      :style="starred ? { color: '#eab308' } : undefined"
      :title="starred ? `取消星标第 ${line + 1} 行` : `星标第 ${line + 1} 行`"
      aria-label="星标当前行"
      :aria-pressed="starred"
      @mousedown.prevent
      @click="toggleStar"
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
        <path
          d="M12 2.6l2.9 6 6.5.9-4.7 4.6 1.1 6.5-5.8-3.1-5.8 3.1 1.1-6.5L2.6 9.5l6.5-.9 2.9-6Z"
        />
      </svg>
    </button>

    <!-- 行颜色：圆形色块就是当前颜色（默认 = 空心圆）。显示开关关掉时入口一并隐藏。 -->
    <button
      v-if="showLineColors"
      type="button"
      class="flex h-6 w-6 items-center justify-center rounded transition hover:bg-slate-700"
      aria-label="行颜色"
      title="行颜色"
      aria-haspopup="dialog"
      :aria-expanded="paletteOpen"
      @mousedown.prevent
      @click="togglePalette"
    >
      <span
        class="h-2.5 w-2.5 rounded-full ring-1 ring-slate-500"
        :style="{ backgroundColor: color ?? 'transparent' }"
      />
    </button>

    <!-- 删除当前行：与 Ctrl+D / 右键菜单同一条实现，直接删、靠 Ctrl+Z 兜底。 -->
    <button
      type="button"
      class="flex h-6 w-6 items-center justify-center rounded text-slate-300 transition hover:bg-slate-700 hover:text-rose-400"
      aria-label="删除当前行"
      title="删除当前行 (Ctrl+D)"
      @mousedown.prevent
      @click="startDelete"
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

    <span class="sr-only" aria-live="polite">
      {{ copyState === "ok" ? "已复制" : copyState === "fail" ? "复制失败" : "" }}
    </span>

    <!-- 色板：fixed 浮层（z-40，与右键菜单同档）。第一项「默认」= 清掉这一行的颜色。 -->
    <div
      v-if="paletteOpen"
      class="fixed z-40 grid grid-cols-5 gap-1 rounded-lg border border-slate-700 bg-slate-800 p-2 shadow-xl"
      :style="{ left: `${palettePos.x}px`, top: `${palettePos.y}px` }"
      role="dialog"
      aria-label="行颜色"
    >
      <button
        v-for="item in LINE_COLORS"
        :key="item.label"
        type="button"
        class="flex h-5 w-5 items-center justify-center rounded ring-1"
        :class="color === item.value ? 'ring-slate-100' : 'ring-transparent'"
        :aria-label="item.label"
        :title="item.label"
        @mousedown.prevent
        @click="pickColor(item.value)"
      >
        <span
          class="h-3 w-3 rounded-full"
          :style="{ backgroundColor: item.value === null ? 'var(--note-fg-faint)' : item.value }"
        />
      </button>
    </div>
  </div>
</template>
