<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { getCurrentWindow } from "@tauri-apps/api/window";
import NoteEditor from "@/features/notes/NoteEditor.vue";
import { useNotes } from "@/features/notes/useNotes";
import { applyAutoStart, autoStart, setAutoStart } from "@/features/settings/autostart";
import {
  BACKGROUND_ALPHA_MAX,
  BACKGROUND_ALPHA_MIN,
  BACKGROUND_ALPHA_STEP,
  BACKGROUND_DEFAULT,
  backgroundAlpha,
  backgroundColor,
  previewBackgroundColor,
  resetBackgroundColor,
  setBackgroundAlpha,
  setBackgroundColor,
} from "@/features/settings/background";
import { FONT_SIZE_MAX, FONT_SIZE_MIN, fontSize, setFontSize } from "@/features/settings/fontSize";
import {
  FOREGROUND_DEFAULT,
  foregroundColor,
  previewForegroundColor,
  resetForegroundColor,
  setForegroundColor,
} from "@/features/settings/foreground";
import {
  LINE_HEIGHT_MAX,
  LINE_HEIGHT_MIN,
  lineHeightRatio,
  setLineHeightRatio,
} from "@/features/settings/lineHeight";
import type { Theme } from "@/features/settings/themes";
import { contrastRatio, matchTheme, THEMES } from "@/features/settings/themes";
import {
  applySecondaryPanel,
  clampMainWidth,
  commitMainPanelWidth,
  MAIN_MIN_W,
  mainPanelWidth,
  secondaryOpen,
  setMainPanelWidth,
  setSecondaryOpen,
  syncPanelWidthLimits,
} from "@/features/settings/secondaryPanel";
import { log } from "@/utils/logger";

const { ready, error } = useNotes("main");
/// 次级面板那份内容与主面板各读各的文件（同一套 `useNotes`，只差一个面板名）
const { ready: secondaryReady } = useNotes("secondary");

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
  // 次级面板：按偏好（缺省 = 关）把窗口兜到放得下的宽度。窗口尺寸由 window-state 恢复，
  // 这里只补「恢复出来的宽度装不下两栏」这种情况。
  void applySecondaryPanel();
});

/// 设置面板底部的版本号：构建期由 vite 注入（`define`），单一事实源是 package.json。
/// 必须先赋给 setup 里的绑定，模板才能引用 —— `<script setup>` 的模板只看得到作用域内的名字。
const appVersion = __APP_VERSION__;

/// 设置面板是否展开。收起入口统一走 `closeSettings`：点正文区、`Esc`、再点齿轮
const settingsOpen = ref(false);

/// 点一组推荐：把前景与背景**一起**设好（连着两次 setter，没有第三份状态、也就没有隐藏联动）。
/// 之后照样能用两个取色器各自微调 —— 那是"自定义"，`currentThemeName` 会自动变成 `null`。
function applyTheme(theme: Theme) {
  setForegroundColor(theme.fg);
  setBackgroundColor(theme.bg);
}

/// hover 一档 = 实时预览：只写两个 CSS 变量，不落盘、不动 ref。
/// 委托到 `<select>`：选项就在 DOM 里，`mouseover` 会冒泡上来；指针移到非选项处（含触发器本身）→ 还原。
function previewThemeFromEvent(event: MouseEvent): void {
  const option = event.target instanceof HTMLOptionElement ? event.target : null;
  const theme = option ? THEMES.find((item) => item.name === option.value) : null;
  if (!theme) {
    revertThemePreview();
    return;
  }
  previewForegroundColor(theme.fg);
  previewBackgroundColor(theme.bg);
}

/// 还原成**已提交**的那两个颜色（把变量写回 ref 的值）。`mouseleave` / `blur` / 收面板都调它。
function revertThemePreview(): void {
  previewForegroundColor(foregroundColor.value);
  previewBackgroundColor(backgroundColor.value);
}

/// 下拉里选了一档：按名字找回那一组再应用。`value` 用名字而不是颜色 —— 选项文本要显示中文名，
/// 而"两个颜色"本身已经由两个偏好各自记着，没必要再往 `value` 里塞一份。
function onThemeChange(name: string) {
  const theme = THEMES.find((item) => item.name === name);
  if (!theme) return;
  applyTheme(theme);
  revertThemePreview(); // 落盘的值就是预览的值：顺手把变量对齐成"已提交"，免得留着上一档的预览
}

/// 当前两个颜色恰好等于哪一组推荐（都不是就是"自定义"，下拉里显示「自定义」这一项）。
/// 它是**算出来的**，不是存下来的状态 —— 「颜色搭配」只是批量写前景 / 背景，没有第三份事实源。
const currentThemeName = computed(
  () => matchTheme(foregroundColor.value, backgroundColor.value)?.name ?? null,
);

/// 笔记区的 `color-scheme` 跟着底色亮度走：浅色搭配下光标 / 滚动条 / 选区才是浅色那一套。
/// 只改笔记区这一层 —— 标题条与设置面板始终是深色外观，所以不把 `:root` 的 dark 换掉。
const noteColorScheme = computed(() =>
  contrastRatio("#ffffff", backgroundColor.value) < contrastRatio("#000000", backgroundColor.value)
    ? "light"
    : "dark",
);

function closeSettings(): void {
  revertThemePreview(); // 面板一收，先把 hover 预览撤掉，别把没提交的颜色留在界面上
  settingsOpen.value = false;
}

/// ── 次级面板：分界线拖动与那一栏的实际宽度 ────────────────────────────────────

/// 两栏所在的 flex 行（分界线拖动要按它的宽度夹取主面板上限）
const mainRow = ref<HTMLElement | null>(null);
/// 拖动会话：只记起点，宽度由「起点 + 指针位移」算，不累加（累加会把抖动也攒起来）
const dividerDrag = ref<{ startX: number; startWidth: number; containerWidth: number } | null>(
  null,
);

/// 分界线按下：抓住指针（跑出那 6px 也收得到 move），并 `preventDefault` 挡住 textarea 抢选中
function onDividerDown(e: PointerEvent): void {
  const row = mainRow.value;
  if (!row || !(e.target instanceof HTMLElement)) return;
  e.preventDefault();
  e.target.setPointerCapture(e.pointerId);
  dividerDrag.value = {
    startX: e.clientX,
    startWidth: mainPanelWidth.value,
    containerWidth: row.getBoundingClientRect().width,
  };
}

/// 拖动中：只改主面板宽度 —— 次级 `flex-1` 自动让位，**窗口宽一个像素都不动**
function onDividerMove(e: PointerEvent): void {
  const drag = dividerDrag.value;
  if (!drag) return;
  setMainPanelWidth(
    clampMainWidth(drag.startWidth + (e.clientX - drag.startX), drag.containerWidth),
  );
}

/// 松手：把分界线位置落盘（重启后复原就靠它）+ 把窗口下限对齐到新的主面板宽度。
/// 拖动中不写、不发 IPC —— 每帧一次落盘既吵又会把中间态留在偏好里。
function onDividerUp(): void {
  if (!dividerDrag.value) return;
  dividerDrag.value = null;
  commitMainPanelWidth();
  void syncPanelWidthLimits();
}

/// 切次级面板：点把手与 `Alt+S` 走同一条 —— 面板状态、偏好落盘与窗口宽度都由它包办
function toggleSecondary(): void {
  void setSecondaryOpen(!secondaryOpen.value);
}

/// `Esc` 收设置面板、`Alt+S` 切次级面板：两者都挂 `document` 而不是元素级 —— 它们是**窗口级
/// 动作**，焦点不在任何元素上时（刚启动、点过标题条）也要响应。（编辑器那两个快捷键不同：
/// 它们只在编辑器内有意义，才必须元素级、不挂 document。）
function onGlobalKeydown(e: KeyboardEvent): void {
  if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.code === "KeyS") {
    // 组字中是在选字；`repeat` 是按住不放的连发 —— 每次都要发一轮 setMinSize / setSize 的 IPC
    if (e.isComposing || e.repeat) return;
    // `!ctrlKey` 还挡掉了 `AltGr+S`（德语等布局下 AltGr 上报的是 ctrl+alt，那是在打字符）
    e.preventDefault(); // 免得平台把 Alt+字母 当菜单助记键
    toggleSecondary();
    return;
  }
  if (!settingsOpen.value || e.code !== "Escape") return;
  // 颜色搭配的弹层开着时 `Esc` 先归它（`:open` 只在 base-select 生效），别把整个面板也关了
  if (document.querySelector("select.theme-select:open")) return;
  closeSettings();
}

/// 点**标题条**也收起设置面板（用户口径：面板外任何地方）。指针按下即收，与遮罩同一手感。
/// **齿轮除外**：它是开关本身，让它自己 toggle —— 这里先收、它再翻，面板就"关不掉了"。
function onHeaderDown(e: PointerEvent): void {
  if (!settingsOpen.value) return;
  if (e.target instanceof HTMLElement && e.target.closest('button[aria-label="设置"]')) return;
  closeSettings();
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
    class="relative flex h-full flex-col text-[var(--note-fg)]"
    :class="dividerDrag ? 'select-none' : ''"
    :style="{ backgroundColor: 'var(--note-bg-window)' }"
    role="application"
    aria-label="dnote 主窗口"
  >
    <!-- 无边框窗口的标题条：空白处按住可拖动窗口 -->
    <header
      class="flex h-8 shrink-0 items-center gap-1 border-b border-[var(--note-fg-weak)] px-1.5"
      data-tauri-drag-region
      @pointerdown="onHeaderDown"
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
        class="select-none text-xs font-medium tracking-wide text-[var(--note-fg-faint)]"
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
            ? 'text-[var(--note-fg)] hover:bg-[var(--note-fg-veil)]'
            : 'text-[var(--note-fg-faint)] hover:bg-[var(--note-fg-veil)] hover:text-[var(--note-fg)]'
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
            ? 'text-[var(--note-fg)] hover:bg-[var(--note-fg-veil)]'
            : 'text-[var(--note-fg-faint)] hover:bg-[var(--note-fg-veil)] hover:text-[var(--note-fg)]'
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
        class="flex h-6 w-6 items-center justify-center rounded text-[var(--note-fg-faint)] transition hover:bg-[var(--note-fg-veil)] hover:text-[var(--note-fg)]"
        title="隐藏到托盘"
        @click="hideToTray"
      >
        -
      </button>
    </header>

    <!-- 设置面板：在标题条**下方内嵌**弹出（不开独立窗口）。遮罩只盖标题栏以下 ——
         于是面板开着时置顶与 `-` 照常可点，不必"先关面板再点"。 -->
    <!-- 遮罩：**整窗**标题条以下（层级与定位都见 `design.md`「叠层」）。点它任意处收起；
         点**标题条**（遮罩之外）由 `header` 的 `onHeaderDown` 管 —— 齿轮除外（它自己 toggle）。
         面板因此永远是窗口级浮层：贴窗口右缘 = **齿轮正下方**，与次级面板开不开无关
         （曾经把它摁在主面板里，展开次级面板后就和齿轮错位了）。 -->
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

        <!-- 颜色搭配推荐：**每个选项用它自己那套颜色渲染**；收起时控件本身按当前两色画，等于一小片预览。
             **hover 一档直接预览**（只写 CSS 变量、不落盘，指针离开控件即还原），点选才落盘。
             选一档 = 把前景与背景一起设好，之后仍可用下面两个取色器微调；两色都不等于任何一档时显示「自定义」。
             它是**颜色组第一行**（组内不分隔线），排最上面是为了下拉向下展开时下面的空间最多。
             `theme-select` 启用 `appearance: base-select` 接管弹层，见 `style.css`。 -->
        <div class="flex items-center justify-between gap-2 border-t border-slate-700 pt-2">
          <p class="text-xs text-slate-300">颜色搭配推荐</p>
          <select
            aria-label="颜色搭配推荐"
            class="theme-select h-7 w-20 cursor-pointer truncate rounded text-xs"
            :style="{
              color: foregroundColor,
              backgroundColor: backgroundColor,
              colorScheme: noteColorScheme,
            }"
            :value="currentThemeName ?? ''"
            @change="onThemeChange(($event.target as HTMLSelectElement).value)"
            @mouseover="previewThemeFromEvent"
            @mouseleave="revertThemePreview"
            @blur="revertThemePreview"
          >
            <!-- 触发器：base-select 下必须**显式**写这个按钮（隐式按钮不可样式化）。
                 写成 `<component is="button">` 而不是直写 `<button>`：Vue 编译器会误报
                 「button cannot be child of select」（vuejs/core#13608），动态组件绕开那条静态标签校验，
                 渲染出来仍是原生 `<button>`（`style.css` 里照旧按 `> button` 选中它）。 -->
            <component is="button">
              <selectedcontent></selectedcontent>
            </component>
            <!-- 只在两个颜色都不等于任何一档时出现：它是**当前选中的那项**，不是可选项 -->
            <option v-if="currentThemeName === null" value="">自定义</option>
            <option
              v-for="theme in THEMES"
              :key="theme.name"
              :value="theme.name"
              :style="{ '--opt-fg': theme.fg, '--opt-bg': theme.bg }"
            >
              {{ theme.name }}
            </option>
          </select>
        </div>

        <!-- 前景颜色：取色器 + 非默认时「重置」。它喂 `--note-fg`，正文 / 镜像 / 左槽标记 / 色罩
             都跟它走 —— 浅色搭配下才不至于消失或发脏（见 `features/settings/foreground.ts`）。 -->
        <div class="flex items-center justify-between gap-2">
          <p class="text-xs text-slate-300">前景颜色</p>
          <div class="flex items-center gap-2">
            <input
              type="color"
              aria-label="前景颜色"
              class="h-7 w-10 cursor-pointer rounded bg-slate-800"
              :value="foregroundColor"
              @input="setForegroundColor(($event.target as HTMLInputElement).value)"
            />
            <button
              v-if="foregroundColor !== FOREGROUND_DEFAULT"
              type="button"
              class="rounded px-2 py-1 text-[11px] text-slate-400 transition hover:bg-slate-700 hover:text-slate-200"
              aria-label="重置前景颜色"
              @click="resetForegroundColor"
            >
              重置
            </button>
          </div>
        </div>

        <!-- 背景颜色：与「前景颜色」同款。它喂 `--note-bg`（不透明的那份，幽灵行实底也用它），
             整窗真正画的是 `--note-bg-window`（这一份 + 下面的透明度）。 -->
        <div class="flex items-center justify-between gap-2">
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

        <!-- 背景透明度：**整窗**背景的不透明度（1 = 不透明）。滑块 + 定宽读数，与字号 / 行高比同构。
             窗口本身是 `transparent: true`（见 `tauri.conf.json`），所以调低它真的透出桌面。
             下限 0.1：再低就没法保证文字与桌面壁纸的对比了。 -->
        <div class="flex items-center justify-between gap-2">
          <p class="text-xs text-slate-300">背景透明度</p>
          <div class="flex items-center gap-2">
            <input
              type="range"
              :min="BACKGROUND_ALPHA_MIN"
              :max="BACKGROUND_ALPHA_MAX"
              :step="BACKGROUND_ALPHA_STEP"
              aria-label="背景透明度"
              class="w-20 accent-slate-400"
              :value="backgroundAlpha"
              @input="setBackgroundAlpha(Number(($event.target as HTMLInputElement).value))"
            />
            <span class="w-9 text-right text-xs tabular-nums text-slate-400">
              {{ Math.round(backgroundAlpha * 100) }}%
            </span>
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

    <!-- 两块面板：同一窗口里左右并排（**不是**第二个窗口 —— 见 secondaryPanel.ts）。
         **窗口宽 = 主面板宽 + 次级面板宽**，两个拖拽点各改它左侧那一栏：
         - 窗口右缘（系统缩放边框）→ 只改**次级**：所以展开时主面板切成固定宽、次级 `flex-1`
           吃掉窗口增量（纯 CSS，不挂 `Resized` 监听）；关闭态反过来，主面板 `flex-1` 吃满窗口。
         - 两栏之间的分界线（次级栏左缘那条热区）→ 改**主面板**宽度，次级让位、窗口不动。
         两栏同高是 flex 行天然给的。 -->
    <main ref="mainRow" class="flex min-h-0 flex-1" :style="{ colorScheme: noteColorScheme }">
      <!-- 滚动与内边距都由 NoteEditor 自己管（手柄要按行对齐，得跟文本同一套度量）。
           `min-w-0`：不加则 textarea 的固有宽度会把这一栏顶开，次级面板就放不下了。 -->
      <div
        class="relative min-w-0"
        :class="secondaryOpen ? 'shrink-0' : 'flex-1'"
        :style="secondaryOpen ? { width: `${mainPanelWidth || MAIN_MIN_W}px` } : undefined"
      >
        <NoteEditor
          v-if="ready"
          panel="main"
          :font-size="fontSize"
          :line-height-ratio="lineHeightRatio"
        />

        <!-- 次级面板的把手：**圆心锚在主面板右边界**，所以它属于主栏（拖分界线时自己就跟着走了，
             不需要任何监听）。展开态跨在分界线上（`translate-x-1/2`），收起态整圆贴在右缘内侧
             —— 后者是因为圆心若严格落在窗口右缘，右半圆会被窗口裁掉。
             装进圆里 + 实心底（`--note-bg`）：它压得住底下的文字与行内按钮；贴着主栏右缘，
             因此会擦到当前行的「删除」按钮（两者都在右缘，做不到完全不重合 —— 直径收到 14px 后
             按钮的中心点仍在圆外，`e2e` 的语义点击因此不受影响）。
             与分界线热区（同一位置、`z-30`）：圆在 `z-40`，所以中间那 14px 带点不到分界线（认了）。 -->
        <button
          type="button"
          class="absolute top-1/2 right-0 z-40 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full bg-[var(--note-bg)] text-xs leading-none text-[var(--note-fg-faint)] ring-1 ring-[var(--note-fg-weak)] transition hover:text-[var(--note-fg)]"
          :class="secondaryOpen ? 'translate-x-1/2' : ''"
          aria-label="次级面板"
          :aria-expanded="secondaryOpen"
          :title="secondaryOpen ? '收起次级面板 (Alt+S)' : '展开次级面板（不常改的笔记） (Alt+S)'"
          @click="toggleSecondary"
        >
          {{ secondaryOpen ? "‹" : "›" }}
        </button>
      </div>

      <!-- 次级面板：不常改的笔记单独存一个文件（`dnote-secondary.txt`），操作与主面板完全一致
           （同一个组件、同一套命令，只差 `panel`）。`flex-1`：窗口加宽的增量归它，主面板不动。 -->
      <div
        v-if="secondaryOpen"
        data-panel-frame="secondary"
        class="relative min-w-0 flex-1 border-l border-[var(--note-fg-weak)]"
      >
        <!-- 分界线热区：盖在那条 1px 边上（跨 ±3px），只在展开时存在。拖它改主面板宽度 ——
             拖动期间 `preventDefault` 挡住 textarea 的选中，`setPointerCapture` 保证指针跑出
             这 6px 也照样收得到 move（行拖拽那套也是这个手法，见 NoteEditor.vue）。 -->
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="拖动调整主面板宽度"
          class="absolute inset-y-0 left-0 z-30 w-1.5 -translate-x-1/2 cursor-col-resize transition-colors hover:bg-[var(--note-fg-weak)]"
          @pointerdown="onDividerDown"
          @pointermove="onDividerMove"
          @pointerup="onDividerUp"
          @pointercancel="onDividerUp"
        ></div>

        <NoteEditor
          v-if="secondaryReady"
          panel="secondary"
          :font-size="fontSize"
          :line-height-ratio="lineHeightRatio"
        />
      </div>
    </main>

    <footer
      v-if="error"
      class="shrink-0 border-t border-rose-900/60 bg-rose-950/60 px-3 py-1 text-xs text-rose-300"
    >
      {{ error }}
    </footer>
  </div>
</template>
