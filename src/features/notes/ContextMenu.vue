<script lang="ts">
/** 一个菜单项：`label` 由调用方拼好（含「N 行」），`onPick` 是它对那一块行范围要做的事 */
export interface ContextMenuItem {
  label: string;
  /// 破坏性动作（删除）：hover 用红色，与行内删除按钮同一口径
  danger?: boolean;
  onPick: () => void;
}
</script>

<script setup lang="ts">
/**
 * 右键菜单：**纯展示** —— 摆在哪、有哪些项、点了做什么，全由 `NoteEditor` 决定
 * （只有它知道选区覆盖哪几行）。层级用已有的 `z-40`（与次级面板圆把手同档、本组件 DOM 更靠后），
 * 见 `design.md`「叠层」。
 *
 * `fixed` + client 坐标：不受父级滚动与裁剪影响；**位置在挂载时夹一次**（`menuPosition`）——
 * 窗口是无边框的，菜单越出窗口边界就是真的看不见。挂载钩子同步跑在首次绘制之前，不会闪一下。
 */
import { onMounted, ref } from "vue";
import { menuPosition } from "@/features/notes/logic";

const props = defineProps<{ x: number; y: number; items: readonly ContextMenuItem[] }>();

const root = ref<HTMLElement | null>(null);
const position = ref({ x: props.x, y: props.y });

onMounted(() => {
  const el = root.value;
  if (!el) return;
  const rect = el.getBoundingClientRect();
  position.value = menuPosition(
    props.x,
    props.y,
    rect.width,
    rect.height,
    window.innerWidth,
    window.innerHeight,
  );
});
</script>

<template>
  <!-- 两个修饰符都是必需的：
       - `@pointerdown.stop`：否则"点别处收起"会先把我们摘掉，菜单项的 `click` 再也收不到；
       - `@mousedown.prevent`：不抢 textarea 的焦点（与行内按钮同款）—— 否则按下那一下编辑器先
         `blur`，`onBlur` 会把菜单收掉，`click` 同样到不了按钮（踩过）。 -->
  <div
    ref="root"
    class="fixed z-40 min-w-[7rem] rounded-lg border border-slate-700 bg-slate-800 py-1 shadow-xl"
    :style="{ left: `${position.x}px`, top: `${position.y}px` }"
    role="menu"
    aria-label="笔记操作"
    @pointerdown.stop
    @mousedown.prevent
    @contextmenu.prevent
  >
    <button
      v-for="item in items"
      :key="item.label"
      type="button"
      role="menuitem"
      class="block w-full px-3 py-1.5 text-left text-xs text-slate-300 transition hover:bg-slate-700"
      :class="item.danger ? 'hover:text-rose-400' : 'hover:text-slate-100'"
      @click="item.onPick()"
    >
      {{ item.label }}
    </button>
  </div>
</template>
