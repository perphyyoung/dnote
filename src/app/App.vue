<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import { getCurrentWindow } from "@tauri-apps/api/window";
import NoteEditor from "@/features/notes/NoteEditor.vue";
import { useNotes } from "@/features/notes/useNotes";
import { applyAutoStart, autoStart, setAutoStart } from "@/features/settings/autostart";
import {
  BACKGROUND_DEFAULT,
  backgroundColor,
  resetBackgroundColor,
  setBackgroundColor,
} from "@/features/settings/background";
import { FONT_SIZE_MAX, FONT_SIZE_MIN, fontSize, setFontSize } from "@/features/settings/fontSize";
import {
  LINE_HEIGHT_MAX,
  LINE_HEIGHT_MIN,
  lineHeightRatio,
  setLineHeightRatio,
} from "@/features/settings/lineHeight";
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
  // 开机自启同理：按偏好（缺省 = 开）幂等应用一次；后端在 dev / 无人值守下不写注册表
  void applyAutoStart();
});

/// 设置面板底部的版本号：构建期由 vite 注入（`define`），单一事实源是 package.json。
/// 必须先赋给 setup 里的绑定，模板才能引用 —— `<script setup>` 的模板只看得到作用域内的名字。
const appVersion = __APP_VERSION__;

/// 设置面板是否展开。收起入口统一走 `closeSettings`：点正文区、`Esc`、再点齿轮
const settingsOpen = ref(false);

function closeSettings(): void {
  settingsOpen.value = false;
}

/// `Esc` 收起：这里挂 `document` 而不是元素级 —— 面板里只有滑块可聚焦，点面板空白处后焦点
/// 不在任何元素上，元素级监听收不到。（编辑器那两个快捷键不同：它们只在编辑器内有意义，
/// 才必须元素级、不挂 document。）
function onGlobalKeydown(e: KeyboardEvent): void {
  if (settingsOpen.value && e.code === "Escape") closeSettings();
}

onMounted(() => document.addEventListener("keydown", onGlobalKeydown));
onUnmounted(() => document.removeEventListener("keydown", onGlobalKeydown));

function hideToTray() {
  closeSettings(); // 顺手收起面板：收进托盘时不该留一个"展开着"的界面状态
  // 无边框窗口没有系统按钮，隐藏到托盘（core:window:allow-hide）
  void getCurrentWindow().hide();
}
</script>

<template>
  <div
    class="relative flex h-full flex-col text-slate-200"
    :style="{ backgroundColor: 'var(--note-bg)' }"
    role="application"
    aria-label="dnote 主窗口"
  >
    <!-- 无边框窗口的标题条：空白处按住可拖动窗口 -->
    <header
      class="flex h-8 shrink-0 items-center gap-1 border-b border-slate-800 px-1.5"
      data-tauri-drag-region
    >
      <!-- 应用图标：与 favicon 同一份资产（`public/icon.png`），装饰性 —— 语义由旁边的名称承担。
           `pointer-events-none` 是为了让事件穿透到 header：抓着图标也能拖窗口（拖动判定看的是
           「指针下那个元素带不带 data-tauri-drag-region」）。不加圆角：图标本身就是圆角方块。 -->
      <img
        src="/icon.png"
        alt=""
        aria-hidden="true"
        class="pointer-events-none h-3.5 w-3.5 shrink-0 select-none"
      />
      <!-- 名称也要带拖动标记：拖动判定看的是「指针下那个元素**自己**带不带」，父元素（header）带了不算 -->
      <span
        class="select-none text-xs font-medium tracking-wide text-slate-500"
        data-tauri-drag-region
      >
        dnote
      </span>
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
        class="flex h-6 w-6 items-center justify-center rounded transition"
        :class="
          settingsOpen
            ? 'text-slate-200 hover:bg-slate-800'
            : 'text-slate-500 hover:bg-slate-800 hover:text-slate-200'
        "
        title="设置"
        aria-label="设置"
        aria-haspopup="dialog"
        :aria-expanded="settingsOpen"
        @click="settingsOpen = !settingsOpen"
      >
        ⚙
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

    <!-- 设置面板：在标题条**下方内嵌**弹出（不开独立窗口）。遮罩只盖标题栏以下 ——
         于是面板开着时置顶与 `-` 照常可点，不必"先关面板再点"。 -->
    <div
      v-if="settingsOpen"
      class="absolute inset-x-0 top-8 bottom-0 z-30"
      @pointerdown="closeSettings"
    >
      <div
        class="absolute right-2 top-1 w-56 space-y-2 rounded-lg border border-slate-700 bg-slate-800 p-3 shadow-xl"
        role="dialog"
        aria-label="设置"
        @pointerdown.stop
      >
        <!-- 四行同构：左标签 + 右控件（不给设置项写说明文案） -->
        <div class="flex items-center justify-between gap-2">
          <p class="text-xs text-slate-300">字体大小</p>
          <div class="flex items-center gap-2">
            <input
              type="range"
              :min="FONT_SIZE_MIN"
              :max="FONT_SIZE_MAX"
              step="1"
              aria-label="笔记字体大小"
              class="w-20 accent-slate-400"
              :value="fontSize"
              @input="setFontSize(Number(($event.target as HTMLInputElement).value))"
            />
            <!-- 定宽 + tabular-nums：拖动时数字宽度不跳，滑块不会被顶着抖 -->
            <span class="w-9 text-right text-xs tabular-nums text-slate-400">{{ fontSize }}px</span>
          </div>
        </div>

        <!-- 行高比：与「字体大小」**完全同构**（滑块 + 定宽读数，没有「重置」—— 同组控件
             要一致；滑块能自己拖回，读数又一直显示当前倍数）。排在它下面、同一组内不加分隔线。
             读数带倍数符号 `×`，一眼看出是倍数而不是 px（术语见「通用语言.md」）。 -->
        <div class="flex items-center justify-between gap-2">
          <p class="text-xs text-slate-300">行高比</p>
          <div class="flex items-center gap-2">
            <input
              type="range"
              :min="LINE_HEIGHT_MIN"
              :max="LINE_HEIGHT_MAX"
              step="0.1"
              aria-label="笔记行高比"
              class="w-20 accent-slate-400"
              :value="lineHeightRatio"
              @input="setLineHeightRatio(Number(($event.target as HTMLInputElement).value))"
            />
            <span class="w-9 text-right text-xs tabular-nums text-slate-400">
              {{ lineHeightRatio.toFixed(1) }}×
            </span>
          </div>
        </div>

        <div class="flex items-center justify-between gap-2 border-t border-slate-700 pt-2">
          <p class="text-xs text-slate-300">背景颜色</p>
          <div class="flex items-center gap-2">
            <input
              type="color"
              aria-label="背景颜色"
              class="h-7 w-10 cursor-pointer rounded bg-slate-800"
              :value="backgroundColor"
              @input="setBackgroundColor(($event.target as HTMLInputElement).value)"
            />
            <!-- 只在非默认色时出现（与 cdown 的「重置」同款） -->
            <button
              v-if="backgroundColor !== BACKGROUND_DEFAULT"
              type="button"
              class="rounded px-2 py-1 text-[11px] text-slate-400 transition hover:bg-slate-700 hover:text-slate-200"
              aria-label="重置背景颜色"
              @click="resetBackgroundColor"
            >
              重置
            </button>
          </div>
        </div>

        <div class="flex items-center justify-between gap-2 border-t border-slate-700 pt-2">
          <p class="text-xs text-slate-300">开机自启</p>
          <!-- 开关样式与角色照 cdown 的 SettingsToggle：点击直接上报，失败由上层回滚 -->
          <button
            type="button"
            role="switch"
            :aria-checked="autoStart"
            aria-label="开机自启"
            class="relative h-5 w-9 shrink-0 rounded-full transition-colors"
            :class="autoStart ? 'bg-emerald-600' : 'bg-slate-700'"
            @click="setAutoStart(!autoStart)"
          >
            <span
              class="absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-slate-100 transition-transform"
              :class="autoStart ? 'translate-x-4' : 'translate-x-0'"
            />
          </button>
        </div>

        <!-- 最底下一行：版本号。不是设置项，但结构与上面几行一致（左标签 + 右信息） -->
        <div class="flex items-center justify-between gap-2 border-t border-slate-700 pt-2">
          <p class="text-xs text-slate-300">版本号</p>
          <span class="text-xs text-slate-400">v{{ appVersion }}</span>
        </div>
      </div>
    </div>

    <!-- 滚动与内边距都由 NoteEditor 自己管（手柄要按行对齐，得跟文本同一套度量） -->
    <main class="min-h-0 flex-1">
      <NoteEditor v-if="ready" :font-size="fontSize" :line-height-ratio="lineHeightRatio" />
    </main>

    <footer
      v-if="error"
      class="shrink-0 border-t border-rose-900/60 bg-rose-950/60 px-3 py-1 text-xs text-rose-300"
    >
      {{ error }}
    </footer>
  </div>
</template>
