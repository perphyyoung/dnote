<script setup lang="ts">
import { onMounted, ref } from "vue";
import { getCurrentWindow } from "@tauri-apps/api/window";
import NoteEditor from "@/features/notes/NoteEditor.vue";
import { useNotes } from "@/features/notes/useNotes";
import { log } from "@/utils/logger";

const { ready, error } = useNotes();

/// 置顶偏好存 WebView 的 localStorage：它是「界面偏好」而不是笔记内容，
/// 混进 dnote.txt 会破坏「存储内容 = 界面内容」的约定。窗口配置默认置顶，
/// 这里只负责「上次取消过就恢复成不取消」。
const PIN_KEY = "dnote:always-on-top";
const alwaysOnTop = ref(true);

/// 只应用不落盘：启动时用它把窗口状态与偏好对齐
async function applyPin(on: boolean) {
  try {
    await getCurrentWindow().setAlwaysOnTop(on);
    alwaysOnTop.value = on;
  } catch (e) {
    log.error("[pin] 置顶切换失败", String(e));
  }
}

/// 用户点击：应用 + 记住
async function setPin(on: boolean) {
  await applyPin(on);
  localStorage.setItem(PIN_KEY, on ? "1" : "0");
}

function togglePin() {
  void setPin(!alwaysOnTop.value);
}

// 启动时始终按解析结果应用一次（未存过 = 沿用窗口配置的默认值「置顶」）。
// 不写成「只在取消过时才应用」：页面重载不会重建窗口，窗口的置顶状态会留着，
// 只改 ref 会与窗口实际状态错位。
onMounted(() => {
  void applyPin(localStorage.getItem(PIN_KEY) !== "0");
});

function hideToTray() {
  // 无边框窗口没有系统按钮，隐藏到托盘（core:window:allow-hide）
  void getCurrentWindow().hide();
}
</script>

<template>
  <div
    class="flex h-full flex-col bg-slate-900 text-slate-200"
    role="application"
    aria-label="dnote 主窗口"
  >
    <!-- 无边框窗口的标题条：空白处按住可拖动窗口 -->
    <header
      class="flex h-8 shrink-0 items-center gap-1 border-b border-slate-800 px-1.5"
      data-tauri-drag-region
    >
      <span class="select-none pl-1 text-xs font-medium tracking-wide text-slate-500"> dnote </span>
      <span class="flex-1 self-stretch" data-tauri-drag-region></span>
      <button
        type="button"
        class="flex h-6 w-6 items-center justify-center rounded transition"
        :class="
          alwaysOnTop
            ? 'text-slate-200 hover:bg-slate-800'
            : 'text-slate-500 hover:bg-slate-800 hover:text-slate-200'
        "
        :title="alwaysOnTop ? '取消置顶' : '置顶'"
        aria-label="置顶"
        :aria-pressed="alwaysOnTop"
        @click="togglePin"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="13"
          height="13"
          viewBox="0 0 24 24"
          :fill="alwaysOnTop ? 'currentColor' : 'none'"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          class="transition-transform"
          :class="alwaysOnTop ? 'rotate-45' : ''"
        >
          <line x1="12" x2="12" y1="17" y2="22" />
          <path
            d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"
          />
        </svg>
      </button>
      <button
        type="button"
        class="flex h-6 w-6 items-center justify-center rounded text-slate-500 transition hover:bg-slate-800 hover:text-slate-200"
        title="隐藏到托盘"
        @click="hideToTray"
      >
        -
      </button>
    </header>

    <!-- 滚动与内边距都由 NoteEditor 自己管（手柄要按行对齐，得跟文本同一套度量） -->
    <main class="min-h-0 flex-1">
      <NoteEditor v-if="ready" />
    </main>

    <footer
      v-if="error"
      class="shrink-0 border-t border-rose-900/60 bg-rose-950/60 px-3 py-1 text-xs text-rose-300"
    >
      {{ error }}
    </footer>
  </div>
</template>
