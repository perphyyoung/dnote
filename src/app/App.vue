<script setup lang="ts">
import { getCurrentWindow } from "@tauri-apps/api/window";
import NotesPanel from "@/features/notes/NotesPanel.vue";
import { useNotes } from "@/features/notes/useNotes";

const { ready, error, appendRow } = useNotes();

function hideToTray() {
  // 无边框窗口没有系统按钮，隐藏到托盘（core:window:allow-hide）
  void getCurrentWindow().hide();
}
</script>

<template>
  <div class="flex h-full flex-col bg-slate-900 text-slate-200">
    <!-- 无边框窗口的标题条：空白处按住可拖动窗口 -->
    <header
      class="flex h-8 shrink-0 items-center gap-1 border-b border-slate-800 px-1.5"
      data-tauri-drag-region
    >
      <span class="select-none pl-1 text-xs font-medium tracking-wide text-slate-500"> dnote </span>
      <span class="flex-1 self-stretch" data-tauri-drag-region></span>
      <button
        type="button"
        class="flex h-6 w-6 items-center justify-center rounded text-slate-500 transition hover:bg-slate-800 hover:text-slate-200"
        title="新建一行"
        @click="appendRow"
      >
        ＋
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

    <main class="min-h-0 flex-1 overflow-y-auto px-1.5 py-2">
      <NotesPanel v-if="ready" />
    </main>

    <footer
      v-if="error"
      class="shrink-0 border-t border-rose-900/60 bg-rose-950/60 px-3 py-1 text-xs text-rose-300"
    >
      {{ error }}
    </footer>
  </div>
</template>
