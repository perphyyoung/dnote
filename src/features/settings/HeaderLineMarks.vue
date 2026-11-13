<script setup lang="ts">
/**
 * 标题条的「行标记」入口：星标 + 行颜色，作用于**当前定位行**。
 *
 * 两个入口共用一套生命周期（有行才出现、失焦即收），所以放在同一组件里 —— 外壳只需在
 * 定位到行时渲染它，不必各写一遍显示条件与状态。
 *
 * 按钮一律 `mousedown.prevent`：点下去不能把编辑器焦点夺走，否则 `locate` 先变 null、
 * 这个组件会先被卸载，点击就落空了。
 */
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { menuPosition } from "@/features/notes/logic";
import type { Panel } from "@/features/notes/useNotes";
import { LINE_COLORS, type LineColor } from "@/features/settings/lineColors";
import { useLineMarks } from "@/features/settings/lineMarks";

const props = defineProps<{ panel: Panel; line: number }>();

/// 面板在定位切换时可能变（主 → 次级），所以按 prop 取当前那一份 store
const marks = computed(() => useLineMarks(props.panel));
const starred = computed(() => marks.value.starAt(props.line));
const color = computed(() => marks.value.colorAt(props.line));

function toggleStar(): void {
  marks.value.setStar(props.line, !starred.value);
}

// ── 行颜色色板：fixed 浮层，位置按按钮实测一次（不受标题条裁剪）──────────────
/// 色板尺寸（20px 按钮 × 5 列 / 2 行 + gap + padding）：只用来夹取位置，别跟模板里的类名各写一套。
/// 5 列时第三列的中心正好是色板水平中线 —— 所以「居中摆放」就等于「第三列对齐入口」。
const PALETTE_W = 132;
const PALETTE_H = 60;
const paletteOpen = ref(false);
const palettePos = ref({ x: 0, y: 0 });

/// 再点自己的入口即收起；打开时**水平居中对齐入口**（第三列正对入口，最近的色就在指针下方），
/// 越界交给 `menuPosition` 翻边
function togglePalette(event: MouseEvent): void {
  if (paletteOpen.value) {
    paletteOpen.value = false;
    return;
  }
  const button = event.currentTarget as HTMLElement;
  const rect = button.getBoundingClientRect();
  palettePos.value = menuPosition(
    rect.left + rect.width / 2 - PALETTE_W / 2,
    rect.bottom + 4,
    PALETTE_W,
    PALETTE_H,
    window.innerWidth,
    window.innerHeight,
  );
  paletteOpen.value = true;
}

function pickColor(value: LineColor): void {
  marks.value.setColor(props.line, value);
  paletteOpen.value = false;
}

/// 行号 / 面板变了就收起色板：它作用的是"刚才那一行"，别让它悬在别的行上
watch(
  () => [props.panel, props.line],
  () => {
    paletteOpen.value = false;
  },
);

/// 点组件外任意处 / `Esc` 都收起（组件根上 `pointerdown.stop`，点自己不会误收）
function onDocumentPointerDown(): void {
  paletteOpen.value = false;
}

function onDocumentKeydown(event: KeyboardEvent): void {
  if (event.code === "Escape" && paletteOpen.value) paletteOpen.value = false;
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
  <div class="flex shrink-0 items-center gap-1" @pointerdown.stop>
    <!-- 星标：黄色是唯一形态；再点一次取消。 -->
    <button
      type="button"
      class="flex h-6 w-6 items-center justify-center rounded transition"
      :class="starred ? 'text-[var(--note-fg)]' : 'text-[var(--note-fg-faint)]'"
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

    <!-- 行颜色：圆形色块就是当前颜色（默认 = 空心圆）。 -->
    <button
      type="button"
      class="flex h-6 w-6 items-center justify-center rounded transition hover:bg-[var(--note-fg-veil)]"
      aria-label="行颜色"
      title="行颜色"
      aria-haspopup="dialog"
      :aria-expanded="paletteOpen"
      @mousedown.prevent
      @click="togglePalette"
    >
      <span
        class="h-2.5 w-2.5 rounded-full ring-1 ring-[var(--note-fg-faint)]"
        :style="{ backgroundColor: color ?? 'transparent' }"
      />
    </button>

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
        :class="color === item.value ? 'ring-[var(--note-fg)]' : 'ring-transparent'"
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
