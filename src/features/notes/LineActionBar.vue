<script setup lang="ts">
/**
 * 光标行的操作浮条：**复制 / 星标 / 行颜色 / 删除 / 编辑器失焦**。
 *
 * 由 `NoteEditor` 按**光标所在行**定位（`fixed`、视口坐标）后渲染；浮条不跟指针走，
 * 所以指针移到浮条上时它不会跑。这里只负责按钮与复制反馈；星标 / 行颜色直接读写
 * `lineMarks`，复制 / 删除 / 编辑器失焦向父组件抛事件（那里才有文本、行标记与撤销栈）。
 *
 * 按钮一律 `mousedown.prevent`：按下不抢编辑器的焦点、也不破坏选区，光标行因此不变，
 * 浮条留在原地。
 */
import { computed } from "vue";
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
  (e: "blur-editor"): void;
}>();

/// 面板 / 行在浮条存续期间不会变（变了父组件会重新定位），但仍按 prop 取那一份 store
const marks = computed(() => useLineMarks(props.panel));
const starred = computed(() => marks.value.starAt(props.line));
const color = computed(() => marks.value.colorAt(props.line));

function toggleStar(): void {
  marks.value.setStar(props.line, !starred.value);
}

function startCopy(): void {
  emit("copy");
}

function startDelete(): void {
  emit("delete");
}

/// 最右的叉号：动作只有「编辑器失焦」，与 `Esc` 同一条实现（由父组件执行 blur）
function blurEditor(): void {
  emit("blur-editor");
}

/// 色板只有四档，直接平铺在浮条上；点「无色」= 清掉
function setColor(value: LineColor): void {
  marks.value.setColor(props.line, value);
}
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

    <!-- 行颜色：只有「无色 + 红 / 绿 / 蓝」四档，直接平铺；显示开关关掉时整组隐藏。 -->
    <template v-if="showLineColors">
      <button
        v-for="item in LINE_COLORS"
        :key="item.label"
        type="button"
        class="flex h-6 w-6 items-center justify-center rounded transition hover:bg-slate-700"
        :aria-label="item.label"
        :title="item.label"
        :aria-pressed="color === item.value"
        @mousedown.prevent
        @click="setColor(item.value)"
      >
        <span
          class="h-3.5 w-3.5 rounded-full"
          :class="color === item.value ? 'ring-2 ring-slate-100' : 'ring-1 ring-slate-500'"
          :style="{ backgroundColor: item.value ?? 'transparent' }"
        />
      </button>
    </template>

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

    <!-- 编辑器失焦：与 Esc 同一条实现；图标与复制 / 删除同规格（13px、stroke 2）。 -->
    <button
      type="button"
      class="flex h-6 w-6 items-center justify-center rounded text-slate-300 transition hover:bg-slate-700 hover:text-slate-100"
      aria-label="编辑器失焦"
      title="编辑器失焦 (Esc)"
      @mousedown.prevent
      @click="blurEditor"
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
        <path d="M18 6 6 18" />
        <path d="m6 6 12 12" />
      </svg>
    </button>

    <span class="sr-only" aria-live="polite">
      {{ copyState === "ok" ? "已复制" : copyState === "fail" ? "复制失败" : "" }}
    </span>
  </div>
</template>
