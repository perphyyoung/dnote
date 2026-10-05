<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import type { LineBox } from "@/features/notes/logic";
import {
  caretLine,
  caretOffset,
  deleteLine,
  insertIndexAt,
  lineIndexAt,
  lineRange,
  moveIndexAfter,
  moveItem,
} from "@/features/notes/logic";
import type { Panel } from "@/features/notes/useNotes";
import { useNotes } from "@/features/notes/useNotes";
import { log } from "@/utils/logger";

/**
 * `fontSize` / `lineHeightRatio` 由外壳从设置偏好传入（见 `features/settings/`），两块面板同款；
 * `panel` 指出这份内容属于哪块面板 —— 它决定读写哪个文件，也是同一套组件能同时服务两块面板的
 * 全部差异（内部状态如 `boxes` / `drag` 都是 setup 内的 ref，每个实例各一份）。
 */
const props = defineProps<{ fontSize: number; lineHeightRatio: number; panel: Panel }>();

const { content, lines, setContent, flushNow } = useNotes(props.panel);

// 手柄要按行对准，所以行高与内边距不能各写各的：下面 textarea 用行内样式就是为了一处定义、
// 两处对齐（圆角块里的类名会被 Tailwind 配置牵着走，行内样式不会）。
/**
 * 行高（px）= 字号 × 行高比。textarea / 镜像 / 行手柄 / 幽灵行 / 视觉行换算 全都读它。
 *
 * **行高必须跟着字号走**：写死一个行高时，默认字号下行高比会接近 2，同屏白白少显示
 * 近三成行；字号调大时又反过来变紧。行高比是设置面板里的偏好，缺省值在
 * `features/settings/lineHeight.ts`，**别把数字写进文档或用例**。
 *
 * 仍以 px 整数喂给 textarea 与镜像（`Math.round`），不用无单位的 `line-height` ——
 * 那样浏览器会算出 22.5px 这种小数，与 JS 侧取整后的值对不上。
 */
const ROW_H = computed(() => Math.round(props.fontSize * props.lineHeightRatio));
const PAD_TOP = 8;
/** 底部多留一条滚动条的高度：长行横向滚动时，别让滚动条盖住最后一行 */
const PAD_BOTTOM = 16;
// 左侧槽只放「续行拐弯箭头 + 拖拽手柄 ⠿」两样，所以回到最初那个宽度（行号已删）
const HANDLE_W = 20;
/** 指针离容器上下边缘多近就开始自动滚动，以及滚动速度（分母越小越快） */
const SCROLL_EDGE = 24;
const SCROLL_DAMPING = 3;

const scroller = ref<HTMLDivElement | null>(null);
const editor = ref<HTMLTextAreaElement | null>(null);
/** 镜像测层：与 textarea 同框同字体，每个逻辑行一个 block —— 折行后的行盒几何全从它读 */
const mirror = ref<HTMLDivElement | null>(null);
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

/**
 * 行盒：每个逻辑行折行后的上沿与总高（内容坐标）。**几何一律实测** —— 折行位置只有浏览器知道，
 * 而 textarea 的 value 不在 DOM 里、问不出它的逐行排版，所以在它旁边放一个「镜像测层」
 * （同框同字体、每个逻辑行一个 block，见模板）来读真实行盒。
 */
const boxes = ref<LineBox[]>([]);

/** 文本区下沿（内容坐标，含 PAD_TOP）：镜像实测；还没量到就先按未折行估算，免得首帧闪一下 */
const textBottom = computed(() => {
  const last = boxes.value.at(-1);
  return last ? last.top + last.height : PAD_TOP + lines.value.length * ROW_H.value;
});

/** textarea 与两个叠层共用的高度：文本区 + 底部留白 */
const editorHeight = computed(() => textBottom.value + PAD_BOTTOM);

/** 第 index 行的行盒上沿；测层还没量到就退回「未折行」的估算 */
function boxTop(index: number): number {
  return boxes.value[index]?.top ?? PAD_TOP + index * ROW_H.value;
}

function boxHeight(index: number): number {
  return boxes.value[index]?.height ?? ROW_H.value;
}

/** 插入位 index 的边界 y：该行盒的上沿；已经到底了就是文本区下沿 */
function insertLineTop(index: number): number {
  return boxes.value[index]?.top ?? textBottom.value;
}

/** 第 index 行占几个视觉行：≥2 就是折行行（行盒高 = 视觉行数 × 行高） */
function rowSpan(index: number): number {
  return Math.max(1, Math.round(boxHeight(index) / ROW_H.value));
}

/**
 * 「续行拐弯箭头」的位置：折行的行，**每个续行前**都常显一个 ↳（第 2..n 个视觉行）。
 *
 * 它负责说明「这几行是同一条笔记」；行号已经删掉（左侧槽只留拖拽手柄 + 这个箭头），
 * 所以标记要落在每个续行上，不能只标第一个 —— 否则第 3 个视觉行起就看不出归属了（见 design.md）。
 */
const continuationArrowTops = computed(() => {
  const tops: number[] = [];
  for (let index = 0; index < lines.value.length; index += 1) {
    for (let row = 1; row < rowSpan(index); row += 1) {
      tops.push(boxTop(index) + row * ROW_H.value);
    }
  }
  return tops;
});

/**
 * 读镜像测层的行盒。**文本、容器宽度、字号、行高比 —— 四个里任何一个变了都必须重测**：
 * 行盒几何由这四者共同决定（前两者决定折行位置，后两者决定每行多高）。少一个，缓存就会
 * 与消费它的 `ROW_H` 不同源 —— 例如改行高比后 `rowSpan = round(旧盒高 / 新行高)` 会算出
 * 假的折行，于是每个逻辑行都长出一个 `↳`（见 `开发经验.md`）。
 * 用两个 rect 相减而不是 `offsetTop`：后者相对 offsetParent 的哪条边容易被记错，
 * 而「镜像与 textarea 同框对齐」这件事用 rect 差值最直白。
 */
function measure(): void {
  const el = mirror.value;
  if (!el) return;
  const base = el.getBoundingClientRect().top;
  boxes.value = Array.from(el.children, (child) => {
    const rect = child.getBoundingClientRect();
    return { top: rect.top - base, height: rect.height };
  });
}

// 文本或行高（字号 × 行高比）一变就重测；flush: 'post' = 等镜像的 DOM 更新完再量。
// 容器宽度那一路由下面的 ResizeObserver 负责 —— **别把 ROW_H 漏掉**：漏了就会拿旧行高下的
// 行盒去配新行高（`rowSpan` 因此凭空算出折行），假换行符会一直挂到下次改文本为止。
watch([lines, ROW_H], measure, { flush: "post" });

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

/** 宽度一变折行位置就变（拉窗口、改缩放 / DPI），所以跟着重测 */
let resizeObserver: ResizeObserver | null = null;

onMounted(() => {
  measure();
  resizeObserver = new ResizeObserver(measure);
  if (scroller.value) resizeObserver.observe(scroller.value);
  document.addEventListener("selectionchange", syncCaretLine);
});

onUnmounted(() => {
  resizeObserver?.disconnect();
  resizeObserver = null;
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
  // 行盒是实测的：折行后一个逻辑行可以很高，所以不能再用「(y - 顶部) / 行高」这种均匀行高算法
  hoverIndex.value = lineIndexAt(e.clientY - rect.top + el.scrollTop, boxes.value);
}

/**
 * 点「最后一行下方」的容器空白区：直接把光标落到文末。
 *
 * 为什么需要兜这一下：textarea 的高度只到内容 + 底部留白，短笔记时它下面还剩一大片容器空白区，
 * 而**点 div 不会把焦点给 textarea** —— 实测结果是编辑器失焦、光标原地不动、接着打字一个字都进不去
 * （textarea 自己内部那 16px 底部留白不在此列：那里的点击原生就落到文末，所以让出去，
 * 否则会把「按 x 点在最后一行某列」这个更好的行为改坏）。
 *
 * 用 `pointerdown` 而不是 `click`：要在浏览器把焦点挪走**之前**拦下来，否则先 blur 再 focus，
 * 「当前行」高亮会闪一下。
 */
function onScrollerDown(e: PointerEvent): void {
  if (e.button !== 0 || drag.value !== null) return; // 非左键 / 拖拽中不管
  const el = scroller.value;
  const area = editor.value;
  if (!el || !area) return;
  if (e.target !== el) return; // textarea 内部 / 手柄 / 行操作按钮各有各的处理，一律让出
  const rect = el.getBoundingClientRect();
  // 右侧滚动条也以容器为事件目标：不排除它的话，在滚动条上按下会被 preventDefault 打断拖动
  const scrollbar = el.offsetWidth - el.clientWidth;
  if (scrollbar > 0 && e.clientX > rect.right - scrollbar) return;
  // 内容坐标：还在文本区（含 textarea 的底部留白）里就交给浏览器；下沿按实测行盒算，折行后同样准
  if (e.clientY - rect.top + el.scrollTop <= textBottom.value) return;
  e.preventDefault(); // 既保住焦点，也免得高亮闪一下
  area.focus();
  const end = area.value.length;
  area.setSelectionRange(end, end);
  syncCaretLine(); // 程序化改光标不一定触发 selectionchange，这里补一次
}

// ── 拖拽调序 ────────────────────────────────────────────────────────────────
function onHandleDown(e: PointerEvent, index: number): void {
  if (e.button !== 0) return;
  const el = scroller.value;
  if (!el) return;
  const rect = el.getBoundingClientRect();
  // 该行盒在视口里的上沿（折行后这一块可能很高）
  const rowTop = rect.top - el.scrollTop + boxTop(index);
  // 抓住指针：拖到编辑器外也能继续收到 move / up
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  drag.value = {
    originIndex: index,
    // 幽灵行固定一个行高，所以抓取偏移也按一个行高钳制：捏在很高的块的下半部分时，
    // 幽灵行贴在该块上沿附近，不会飘出去
    grabOffset: Math.min(Math.max(e.clientY - rowTop, 0), ROW_H.value),
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
  const el = editor.value;
  if (!el) return;
  const from = el.selectionStart; // 拖拽前光标在哪：一并交给 applyEdit 作为撤销后的归位点
  const caret = caretLine(el.value, from);
  const text = moveItem(lines.value, d.originIndex, to).join("\n");
  // 光标跟着「同一行内容」走：被搬的就是它 → 到新位置；不是 → 留在原行（列都不变）
  const anchored = moveIndexAfter(d.originIndex, to, caret.index);
  // 与 Ctrl+D / Alt+↑↓ / 行内按钮同一条路：走 applyEdit 落盘 —— 这一笔进原生撤销栈，
  // 于是**拖拽也能 Ctrl+Z 撤回**，光标也由它一次设到位。
  applyEdit(text, caretOffset(text, anchored, caret.column), from);
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
  d.pointerY = pointerY;
  // 把指针换成**内容坐标**再交给行盒判定：折行后的高度完全由实测决定
  d.insert = insertIndexAt(pointerY - rect.top + el.scrollTop, boxes.value, d.originIndex);
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

/**
 * 最近一次结构性编辑的前后对照，**只用来接管「重做」**。
 *
 * 为什么重做要自己接管：Chromium / WebView2 对「全选 + `insertText`（长且多行）」这一笔
 * **撤销是对的、重做是错的** —— 重做时它按前后缀拼出的文本会丢内容（实测：74 字符 / 11 行的笔记
 * 重做后整整少一行；短笔记与单行文本则正常）。试过的替代写法（最小替换区间、拆成多笔、先删后插、
 * `execCommand("selectAll")`）在「无公共前后缀的长多行文本」上都不成立 —— 要么重做仍错，
 * 要么一次 `Ctrl+Z` 退不干净。所以不再去猜哪种写法能绕开，改为：**重做时按同一份「编辑后文本」
 * 再走一次 `applyEdit`**，于是重做结果恒等于首次编辑的结果，撤销继续交给浏览器原生。
 *
 * - `state`：`applied` = 浏览器撤销栈里这一笔还在（下次 `Ctrl+Z` 撤掉的就是它）；
 *            `undone`  = 它已被撤销（下次 `Ctrl+Y` 该重做它 → 由我们接管）。
 * - `depth`：它被撤掉之后又撤销了几笔别的编辑 —— 那几笔交给浏览器自己重做，退到 `depth === 0`
 *            时才是我们这一笔。
 * - 任何**不是我们发起**的输入（打字 / 粘贴 / 删除…）都让记录作废：用户已经离开这条历史了。
 */
let structural: {
  after: string;
  caretBefore: number;
  caretAfter: number;
  state: "applied" | "undone";
  depth: number;
} | null = null;

/** 所有输入（含原生撤销 / 重做）都从这里进：更新内容，顺带修正撤销带出来的选区 */
function onInput(e: Event): void {
  const el = e.target as HTMLTextAreaElement;
  const inputType = (e as InputEvent).inputType;
  if (inputType === "historyUndo" || inputType === "historyRedo") {
    const caret = Math.min(preEditCaret ?? el.selectionStart, el.value.length);
    preEditCaret = null;
    el.setSelectionRange(caret, caret);
    if (inputType === "historyUndo") {
      if (structural?.state === "applied") {
        // 撤销掉的正是我们那一笔：它的重做由我们接管
        structural.state = "undone";
        structural.depth = 0;
      } else if (structural?.state === "undone") {
        structural.depth += 1; // 又撤了一笔别的：我们那一笔在重做栈里更深了
      }
    } else if (structural?.state === "undone" && structural.depth > 0) {
      structural.depth -= 1; // 浏览器重做的是别人那一笔
    } else {
      structural = null; // 浏览器把重做消化掉了（例如走了菜单重做）：记录不再可靠
    }
  } else {
    preEditCaret = null; // 用户又打字了，上一次结构性编辑的位置不再适用
    structural = null; // 且已经离开这条撤销历史
  }
  setContent(el.value);
}

/**
 * Ctrl+D 删除当前行；Alt+↑/↓ 上下移动当前行；结构性编辑的 Ctrl+Y / Ctrl+Shift+Z 重做。
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
  // 重做：轮到我们那一笔时自己重放（浏览器的重做对「长多行的整篇替换」会丢内容，见 `structural`）。
  // Chromium 里 Ctrl+Y 与 Ctrl+Shift+Z 都是重做键位，两个都得拦；没轮到我们时一律放行给浏览器。
  if ((e.ctrlKey || e.metaKey) && (e.code === "KeyY" || (e.shiftKey && e.code === "KeyZ"))) {
    if (structural?.state === "undone" && structural.depth === 0) {
      e.preventDefault();
      const { after, caretAfter, caretBefore } = structural;
      applyEdit(after, caretAfter, caretBefore);
      log.info("[notes] 重做结构性编辑（自接管，绕开 Chromium 重做的缺陷）");
    }
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
 * 落地一次结构性编辑（整份文本替换）。**所有**结构性编辑都走这里：Ctrl+D、Alt+↑/↓、
 * 行内「删除当前行」按钮、拖拽落盘 —— 一份实现、一份坑、一份测试口径。
 *
 * 优先走 `document.execCommand("insertText")`：它把这一笔并进浏览器自己的撤销栈，于是
 * **Ctrl+Z 能把「删掉一行 / 移走一行 / 拖拽搬动」撤回来**；直接改 value 是进不了撤销栈的，
 * 而且会把插入符甩到文末（取舍见 `design.md`，机制见 `开发经验.md`）。execCommand 万一不可用
 * （返回 false）就回落为直接写。
 *
 * `caret` 是编辑后光标该在哪；`from` 是编辑前光标的位置 —— 撤销会连「编辑前的选区」一起恢复
 * （而我们是全选后替换，于是撤销后整篇被选中），届时用它把光标放回原处并取消选区（见 `onInput`）。
 */
function applyEdit(text: string, caret: number, from: number): void {
  const el = editor.value;
  if (!el) return;
  // 键盘路径本来就在焦点里；鼠标拖拽可能没有（用户可能一直没点进编辑器），而 execCommand
  // 只作用于聚焦元素 —— 先聚焦，顺带让拖完的光标看得见。
  el.focus();
  el.setSelectionRange(0, el.value.length);
  if (!document.execCommand("insertText", false, text)) {
    el.value = text; // 先落到 DOM，保证下面设置光标时作用在新文本上
    setContent(text);
  }
  el.setSelectionRange(caret, caret);
  preEditCaret = from; // 放在最后：否则会被本次编辑自己触发的 input 清掉
  // 记下这一笔「编辑后」的样子：用户撤销后再重做时，就按它重放一次（缘由见 `structural` 的注释）。
  // 也必须放在 execCommand 之后 —— 那一步会同步触发 input，先写会被 onInput 清掉。
  structural = { after: text, caretBefore: from, caretAfter: caret, state: "applied", depth: 0 };
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
    :data-panel="panel"
    @pointerdown="onScrollerDown"
    @pointermove="onHover"
    @pointerleave="hoverIndex = null"
  >
    <!-- 背景装饰层：必须在 textarea **之下** —— 当前行高亮是「给这一行铺底色」，
         而不是「给文字蒙一层灰」。画在文字之上的半透明色块会把文字一起压暗，
         读起来像整行失焦（见 `开发经验.md`「高亮别盖在文字上」）。 -->
    <div
      class="pointer-events-none absolute inset-x-0 top-0"
      :style="{ height: `${editorHeight}px` }"
    >
      <!-- 当前行（光标所在行）：左侧强调条 + 极淡底色；随光标走，失焦即消失。
           折行时覆盖**整个行盒**（一行的排版块有多高就铺多高）。 -->
      <div
        v-if="caretIndex !== null && drag === null"
        class="absolute inset-x-0 border-l-2"
        :data-caret-line="caretIndex"
        :style="{
          borderColor: 'var(--note-fg-faint)',
          backgroundColor: 'var(--note-fg-veil)',
          top: `${boxTop(caretIndex)}px`,
          height: `${boxHeight(caretIndex)}px`,
        }"
      />
    </div>

    <!-- 行手柄层 / 行操作按钮层 / 源行罩 / 落点闪：压在文字**之上**（按钮要可点）。
         整层 pointer-events:none，只有手柄与按钮自己可点 —— 别挡住 textarea 的点击与落光标。
         插入线**不在**这一层：它得压过幽灵行，单独开了 z-[60] 的层（见下）。 -->
    <div
      class="pointer-events-none absolute inset-x-0 top-0 z-20"
      :style="{ height: `${editorHeight}px` }"
    >
      <!-- 被拿起来的那一行：**有意**做成盖在文字上的色罩（「这一行被搬走了」本该灰下去）；
           再加虚线上下沿，让「搬走的是这一整块」有明确起止（折行块可以很高，只靠色罩边界发虚） -->
      <div
        v-if="drag"
        data-drag-source
        class="absolute inset-x-0 border-y border-dashed"
        :style="{
          borderColor: 'var(--note-fg-faint)',
          backgroundColor: 'var(--note-fg-veil)',
          top: `${boxTop(drag.originIndex)}px`,
          height: `${boxHeight(drag.originIndex)}px`,
        }"
      />
      <!-- 松手落点闪一下（220ms 淡出） -->
      <div
        v-if="droppedIndex !== null"
        class="drop-flash absolute inset-x-0 bg-sky-400/20"
        :style="{ top: `${boxTop(droppedIndex)}px`, height: `${boxHeight(droppedIndex)}px` }"
      />
      <!-- 续行拐弯箭头：折行的行，**每个续行前**都常显一个 ↳（常显，不跟悬停走）。
           它与手柄共用左侧槽那一格：同宽（HANDLE_W）+ 水平居中 → 两个标记落在**同一条竖中线**上
           （也就是「文字左缘与左边界」的中点）；而手柄只在逻辑行的首个视觉行、箭头只在续行，
           两者永不同行，所以共用一条中线不会打架。 -->
      <div
        v-for="top in continuationArrowTops"
        :key="top"
        data-continuation-arrow
        class="pointer-events-none absolute text-[10px]"
        :style="{
          color: 'var(--note-fg)',
          top: `${top}px`,
          left: '0px',
          width: `${HANDLE_W}px`,
          textAlign: 'center',
          height: `${ROW_H}px`,
          lineHeight: `${ROW_H}px`,
        }"
      >
        ↳
      </div>
      <!-- 拖拽手柄：**只在逻辑行的首个视觉行**出现（折行块再高也只有一个手柄，不跟着变胖），
           仍然是「指针停在这一行时才显形」。上一版的悬停行号已删 —— 左侧槽只留手柄与续行箭头，
           视觉负担才是对的。 -->
      <button
        v-for="(_, index) in lines"
        :key="index"
        type="button"
        class="pointer-events-auto absolute flex cursor-grab touch-none items-center justify-center transition-opacity active:cursor-grabbing"
        :class="index === hoverIndex || index === drag?.originIndex ? 'opacity-100' : 'opacity-0'"
        :style="{
          color: 'var(--note-fg-faint)',
          top: `${boxTop(index)}px`,
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
      <!-- 按钮本身仍是一行高（不该在长行上变胖），所以放在行盒里**竖直居中** -->
      <div
        v-if="showRowActions"
        class="absolute flex items-center gap-0.5"
        :style="{
          top: `${boxTop(currentLine) + (boxHeight(currentLine) - ROW_H) / 2}px`,
          right: '6px',
          height: `${ROW_H}px`,
        }"
      >
        <button
          type="button"
          class="pointer-events-auto flex h-5 w-5 items-center justify-center rounded bg-[var(--note-bg)] text-[var(--note-fg)] ring-1 ring-[var(--note-fg-weak)] transition hover:ring-[var(--note-fg-faint)]"
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
          class="pointer-events-auto flex h-5 w-5 items-center justify-center rounded bg-[var(--note-bg)] text-[var(--note-fg)] ring-1 ring-[var(--note-fg-weak)] transition hover:text-rose-500 hover:ring-[var(--note-fg-faint)]"
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

    <!-- 插入线：**单独一层、z 高过幽灵行（50）** —— 幽灵行是整条通宽实色、又总压在这一条 28px
         带里，插入线留在上面那个 z-20 层里就会被它盖掉，落点等于看不见（见 design.md「叠层」）。
         两个要点：① 必须**挪出** z-20 那一层 —— 在它的上下文里给孩子写多大的 z 都出不来；
         ② 层仍在 scroller 内，所以坐标照旧是内容坐标，滚动与自动滚动都不需要额外处理。 -->
    <div
      class="pointer-events-none absolute inset-x-0 top-0 z-[60]"
      :style="{ height: `${editorHeight}px` }"
    >
      <!-- 画在哪就插在哪：圆头 + 实色 + 一点外发光，抢注意力 -->
      <div
        v-if="showInsertLine"
        data-insert-line
        class="absolute rounded-full bg-sky-400 shadow-[0_0_6px_rgba(56,189,248,0.55)]"
        :style="{
          top: `${insertLineTop(drag?.insert ?? 0) - 1}px`,
          left: `${HANDLE_W}px`,
          right: '6px',
          height: '2px',
        }"
      />
    </div>

    <!-- 无边框 textarea：编辑语义全交给浏览器 —— 回车在光标处断行（行首回车即在当前位置
         插入新行）、退格 / 删除把相邻两行合并、↑↓ 在行间移动、Ctrl+A / Ctrl+Z / 多行选区
         都是原生的。**长行按右边界折行**（`pre-wrap` + `break-words`）：折行只影响排版，
         逻辑行仍是 `\n` 那一行 —— 手柄 / 高亮 / 插入线的几何由旁边的镜像测层实测给出。
         relative z-10：压在背景装饰层之上、又在手柄层之下，文字因此不会被高亮染色。 -->
    <textarea
      ref="editor"
      class="relative z-10 block w-full resize-none overflow-x-hidden overflow-y-hidden break-words whitespace-pre-wrap border-0 bg-transparent outline-none placeholder:text-[var(--note-fg-faint)]"
      :style="{
        color: 'var(--note-fg)',
        caretColor: 'var(--note-fg)',
        fontSize: 'var(--note-font-size)',
        lineHeight: `${ROW_H}px`,
        height: `${editorHeight}px`,
        padding: `${PAD_TOP}px 6px ${PAD_BOTTOM}px ${HANDLE_W + 2}px`,
      }"
      spellcheck="false"
      aria-label="笔记内容"
      placeholder="写点什么…"
      :value="content"
      @input="onInput"
      @keydown="onKeydown"
      @focus="syncCaretLine"
      @blur="onBlur"
    />

    <!-- 镜像测层：textarea 的 value 不在 DOM 里、问不出它的逐行排版，所以在这里放一个**同框同字体**
         的不可见副本，每个逻辑行一个 block —— 折行后的行盒（上沿 / 总高）全从它读（`measure()`）。
         invisible 仍参与排版、绝对定位不占流，所以既量得准，又不影响滚动高度。
         它必须与 textarea 共用同一批常量、同一套折行属性**与同一个字号**（`--note-font-size`，
         设置面板能改），否则手柄会系统性错位 —— e2e `09` 有一条「镜像总高 ≈ textarea 内容高」
         的护栏盯着这件事，`12` 还会在改字号后再核对一次。 -->
    <div
      ref="mirror"
      data-mirror
      aria-hidden="true"
      class="invisible pointer-events-none absolute inset-x-0 top-0 break-words whitespace-pre-wrap"
      :style="{
        color: 'var(--note-fg)',
        fontSize: 'var(--note-font-size)',
        lineHeight: `${ROW_H}px`,
        padding: `${PAD_TOP}px 6px ${PAD_BOTTOM}px ${HANDLE_W + 2}px`,
      }"
    >
      <!-- v-text 而不是插值：模板里插值周围的缩进会被编译器整理掉，而行内的空格必须原样保留 -->
      <div
        v-for="(line, index) in lines"
        :key="index"
        :style="{ minHeight: `${ROW_H}px` }"
        v-text="line"
      />
    </div>
  </div>

  <!-- 幽灵行：正被拿着的那一行本身，跟手贴着指针（fixed 定位，不参与文本流）。
       底色用**颜色 alpha**（不是 `opacity-*`）留 10% 透光：只为看清下面那一行的字、好判断落点，
       文字与描边保持实心；插入线的可见性由它自己的 z-[60] 层保证，不靠这里透出来（见 design.md「叠层」）。 -->
  <div
    v-if="drag"
    data-drag-ghost
    class="pointer-events-none fixed z-50 flex items-center rounded bg-[var(--note-bg)] shadow-xl ring-1 ring-[var(--note-fg-weak)]"
    :style="{
      top: `${drag.pointerY - drag.grabOffset}px`,
      left: `${drag.ghostLeft}px`,
      width: `${drag.ghostWidth}px`,
      height: `${ROW_H}px`,
    }"
  >
    <span
      class="flex shrink-0 justify-center text-[var(--note-fg-faint)]"
      :style="{ width: `${HANDLE_W + 2}px` }"
    >
      ⠿
    </span>
    <span
      class="min-w-0 flex-1 truncate px-1 text-[var(--note-fg)]"
      :style="{ fontSize: 'var(--note-font-size)' }"
    >
      {{ lines[drag.originIndex] ?? "" }}
    </span>
  </div>
</template>
