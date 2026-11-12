<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import type { LineBox } from "@/features/notes/logic";
import {
  caretLine,
  caretOffset,
  collapseBlankLines,
  deleteLine,
  deleteLines,
  dropSelection,
  insertIndexAt,
  lineIndexAt,
  lineRange,
  moveBlock,
  moveItem,
  menuPosition,
  moveLines,
  selectionLines,
} from "@/features/notes/logic";
import ContextMenu from "@/features/notes/ContextMenu.vue";
import {
  LINE_COLORS,
  remapColors,
  spliceColors,
  useLineColors,
  type LineColor,
} from "@/features/settings/lineColors";
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
/** 幽灵行最多渲几行：整块搬移时大块不撑爆窗口，超出部分只由角标里的行数交代 */
const GHOST_MAX_ROWS = 6;

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

/** 松手后落点闪一下给个「落在这儿了」的收尾（整块：首末行都圈上） */
const droppedRange = ref<{ first: number; last: number } | null>(null);
let dropTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * 拖拽会话。**拖动期间一个字符都不改**：只按指针画幽灵行与插入线，松手那一下才真正重排并落盘。
 * 这样文字不会跳变、光标与撤销栈不受影响 —— 旧实现每次换位都重写 textarea 的值，
 * 正是「拖起来很突兀」的根因（见 `开发经验.md` §3.11）。
 *
 * `first` / `last` 是**被搬块的首末行**：没有选区时两者相等（单行拖拽），
 * 抓起的手柄落在多行选区内时就是整个行范围（见 `design.md` 拖拽节）。
 */
const drag = ref<{
  first: number;
  last: number;
  /** 抓的是块内哪一行：幽灵行从这里往下渲染，抓取偏移也按它的行盒算 */
  grabIndex: number;
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

/** 被搬块的行数：幽灵行角标与落点闪的宽度都用它 */
const dragBlockSize = computed(() =>
  drag.value === null ? 0 : drag.value.last - drag.value.first + 1,
);

/**
 * 幽灵行要渲染的块内行：**从被抓的那一行开始**往下最多 `GHOST_MAX_ROWS` 行。
 * 从抓取行开始而不是块首，是为了让幽灵行始终贴在指针下 —— 抓大块中间某行时，
 * 块首那几行会跑到指针上方很远的地方，看起来像抓错了东西。
 */
const ghostRows = computed(() => {
  const d = drag.value;
  if (d === null) return [];
  return lines.value.slice(d.grabIndex, Math.min(d.last + 1, d.grabIndex + GHOST_MAX_ROWS));
});

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
 * 假的折行，于是每个逻辑行都长出一个 `↳`（见 `开发经验.md` §3.6）。
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

/** 插入线只在真会换位时出现：插回块内（块首上边 … 块末下边）都等于没动 */
const showInsertLine = computed(() => {
  const d = drag.value;
  return d !== null && (d.insert < d.first || d.insert > d.last + 1);
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
  closeContextMenu(); // 焦点走了，右键菜单也该走
  flushNow();
}

/** 宽度一变折行位置就变（拉窗口、改缩放 / DPI），所以跟着重测 */
let resizeObserver: ResizeObserver | null = null;

onMounted(() => {
  measure();
  resizeObserver = new ResizeObserver(measure);
  if (scroller.value) resizeObserver.observe(scroller.value);
  document.addEventListener("selectionchange", syncCaretLine);
  document.addEventListener("pointerdown", onDocumentPointerDown); // 右键菜单：点任何地方都收
});

onUnmounted(() => {
  resizeObserver?.disconnect();
  resizeObserver = null;
  document.removeEventListener("selectionchange", syncCaretLine);
  document.removeEventListener("pointerdown", onDocumentPointerDown);
  stopAutoScroll();
  if (dropTimer !== null) clearTimeout(dropTimer);
  if (copyTimer !== null) clearTimeout(copyTimer);
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
function onHandleDown(e: PointerEvent, fallbackIndex: number): void {
  if (e.button !== 0) return;
  const el = scroller.value;
  const area = editor.value;
  if (!el || !area) return;
  const rect = el.getBoundingClientRect();
  // 手柄索引不能全信：小行高时按钮里的字形会溢出按钮盒，下一行按钮的文字可能盖住上一行
  // 的下半区（pointerdown 于是落到邻行按钮上）。**以指针几何为准**，按钮索引只做兜底。
  const index = lineIndexAt(e.clientY - rect.top + el.scrollTop, boxes.value) ?? fallbackIndex;
  // 只认**可见**的选区：失焦后 selectionStart/End 仍然留着旧值，但用户看不见高亮，
  // 此时按选区搬整块会是「看不见的块被拖走」—— 所以失焦时一律当单行。
  const range =
    document.activeElement === area
      ? selectionLines(area.value, area.selectionStart, area.selectionEnd)
      : null;
  // 抓的是选区内的哪一行：整块搬；抓选区外的手柄仍只搬那一行（按钮与本行手柄保持"指哪打哪"）
  const inSelection = range !== null && index >= range.first && index <= range.last;
  const first = inSelection ? range.first : index;
  const last = inSelection ? range.last : index;
  // 抓取行在视口里的上沿（折行后这一块可能很高）
  const rowTop = rect.top - el.scrollTop + boxTop(index);
  // 抓住指针：拖到编辑器外也能继续收到 move / up
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  drag.value = {
    first,
    last,
    grabIndex: index,
    // 幽灵行固定一个行高，所以抓取偏移也按一个行高钳制：捏在很高的块的下半部分时，
    // 幽灵行贴在该块上沿附近，不会飘出去
    grabOffset: Math.min(Math.max(e.clientY - rowTop, 0), ROW_H.value),
    pointerY: e.clientY,
    insert: first,
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
  // 插回块内（块首上边 … 块末下边）等于没动：不写盘也不闪
  if (d.insert >= d.first && d.insert <= d.last + 1) return;
  // 插入位是「移除之前」的下标：往后拖时要减去整块长度
  const blockSize = d.last - d.first + 1;
  const to = d.insert > d.last ? d.insert - blockSize : d.insert;
  const el = editor.value;
  if (!el) return;
  const from = el.selectionStart; // 拖拽前光标在哪：一并交给 applyEdit 作为撤销后的归位点
  const text = el.value;
  const next = moveBlock(lines.value, d.first, d.last, to).join("\n");
  // 落点（光标 / 选区）由纯函数算：多行整块搬移保留选区并整体平移，单行让光标跟着同一行内容走
  const target = dropSelection(text, next, d.first, d.last, to, el.selectionStart, el.selectionEnd);
  // 与 Ctrl+D / Alt+↑↓ / 行内按钮同一条路：走 applyEdit 落盘 —— 这一笔进原生撤销栈，
  // 于是**拖拽也能 Ctrl+Z 撤回**，光标 / 选区也由它一次设到位。
  applyEdit(next, target, from, moveBlock(paddedColors(), d.first, d.last, to));
  flashDropped(to, to + blockSize - 1);
  log.info(
    d.first === d.last
      ? `[notes] 第 ${d.first + 1} 行拖到第 ${to + 1} 行`
      : `[notes] 第 ${d.first + 1}–${d.last + 1} 行整块拖到第 ${to + 1}–${to + blockSize} 行`,
  );
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
  // 把指针换成**内容坐标**再交给行盒判定：折行后的高度完全由实测决定。
  // 方向基准是**块末行**：指针落在块内任何位置都得到「没动」的插入位。
  d.insert = insertIndexAt(pointerY - rect.top + el.scrollTop, boxes.value, d.last);
}

// ── 应用内快捷键（键位与边界见 design.md 快捷键节）────────────────────────────
// 挂在 textarea 自己的 keydown 上（元素级），不挂 document：编辑器只有一个，元素级天然
// 随组件挂载 / 卸载，既不会残留监听，也不会出现「一次按键被两个监听各处理一遍」。

/**
 * 结构性编辑之前的光标位置，只在「紧接着的这次撤销/重做」里用一次。
 * 之所以需要：Chromium 的撤销会恢复编辑前的选区，而我们的替换是「全选 + 插入」，
 * 撤销后如果不收拾，用户看到的是「文本回来了，但整篇被选中」（见 `开发经验.md` §3.9）。
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
  /// 编辑前的落点：撤销后把选区收成它的 `start`（`onInput` 里那一步）
  targetBefore: { start: number; end: number };
  /// 编辑后的落点：重做时**原样**恢复 —— 多行快捷键的选区因此能跟着块平移（见 `moveCurrentLine`）
  targetAfter: { start: number; end: number };
  /// 颜色也在这一笔里：撤销时恢复 `colorsBefore`，重放时恢复 `colorsAfter`
  /// （颜色是 localStorage 的旁路状态，浏览器撤销栈不会替我们带回来）
  colorsBefore: LineColor[];
  colorsAfter: LineColor[];
  state: "applied" | "undone";
  depth: number;
} | null = null;

// ── 行颜色：左侧强调条 + 行内操作条里的色板 ───────────────────────────────────
const lineColors = useLineColors(props.panel);
/// 色板对哪一行开着（null = 关）；位置在开的时候按按钮实测一次（fixed 浮层，不受滚动裁剪）
const paletteFor = ref<number | null>(null);
const palettePos = ref({ x: 0, y: 0 });
/// 有颜色的行：按实测行盒画强调条（几何一律读镜像，与当前行高亮同一套）
const coloredBars = computed(() =>
  lines.value.flatMap((_, index) => {
    const color = lineColors.colorAt(index);
    return color === null ? [] : [{ index, color }];
  }),
);
/// 结构性编辑已经自己搬过颜色了，别让随之而来的 `input` 再搬一次
let skipColorReconcile = false;

/// 把颜色数组补齐到当前行数，才能交给 `moveItem` / `moveLines` 做和正文同一套置换
function paddedColors(): (string | null)[] {
  return Array.from({ length: lines.value.length }, (_, i) => lineColors.colorAt(i));
}

const PALETTE_W = 5 * 20 + 4 * 4 + 16; // 5 列 × 20px + 4 道缝 + 两侧内边距
const PALETTE_H = 2 * 20 + 4 + 16;

function openPalette(e: MouseEvent, index: number): void {
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  palettePos.value = menuPosition(
    rect.left,
    rect.bottom + 4,
    PALETTE_W,
    PALETTE_H,
    window.innerWidth,
    window.innerHeight,
  );
  paletteFor.value = index;
}

function pickLineColor(color: string | null): void {
  if (paletteFor.value !== null) lineColors.set(paletteFor.value, color);
  paletteFor.value = null;
}

/** 所有输入（含原生撤销 / 重做）都从这里进：更新内容，顺带修正撤销带出来的选区 */
function onInput(e: Event): void {
  closeContextMenu(); // 内容变了：菜单作用于旧选区，留着只会点错
  paletteFor.value = null; // 色板也作用于旧行号，别留着点错
  const el = e.target as HTMLTextAreaElement;
  const inputType = (e as InputEvent).inputType;
  let restoredColors = false;
  if (inputType === "historyUndo" || inputType === "historyRedo") {
    const caret = Math.min(preEditCaret ?? el.selectionStart, el.value.length);
    preEditCaret = null;
    el.setSelectionRange(caret, caret);
    if (inputType === "historyUndo") {
      if (structural?.state === "applied") {
        // 撤销掉的正是我们那一笔：它的重做由我们接管，颜色也一并回到编辑前
        structural.state = "undone";
        structural.depth = 0;
        lineColors.replace(structural.colorsBefore);
        restoredColors = true;
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
  // 原生编辑按"编辑前后行文本的共同前缀 + 行数变化"整体平移颜色（不猜光标位置）。
  // 两种跳过：① 结构性编辑自己搬过颜色（见 applyEdit）；② 撤销刚刚恢复了颜色快照。
  if (skipColorReconcile) {
    skipColorReconcile = false;
  } else if (!restoredColors) {
    lineColors.shift(lines.value, el.value.split("\n"));
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
  if (e.code === "Escape" && contextMenu.value !== null) {
    // 菜单开着时 `Esc` 先归它（设置 / 帮助浮层的遮罩盖住整个编辑器，两者不会同时在）
    e.preventDefault();
    closeContextMenu();
    return;
  }
  if (e.code === "Escape" && paletteFor.value !== null) {
    e.preventDefault();
    e.stopPropagation(); // 别顺手把设置 / 帮助浮层也收了
    paletteFor.value = null;
    return;
  }
  if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.code === "KeyD") {
    e.preventDefault();
    deleteCurrentLine();
    return;
  }
  // 重做：轮到我们那一笔时自己重放（浏览器的重做对「长多行的整篇替换」会丢内容，见 `structural`）。
  // Chromium 里 Ctrl+Y 与 Ctrl+Shift+Z 都是重做键位，两个都得拦；没轮到我们时一律放行给浏览器。
  if (
    (e.ctrlKey || e.metaKey) &&
    !e.altKey &&
    (e.code === "KeyY" || (e.shiftKey && e.code === "KeyZ"))
  ) {
    if (structural?.state === "undone" && structural.depth === 0) {
      e.preventDefault();
      const { after, targetAfter, targetBefore, colorsAfter } = structural;
      applyEdit(after, targetAfter, targetBefore.start, colorsAfter);
      log.info("[notes] 重做结构性编辑（自接管，绕开 Chromium 重做的缺陷）");
    }
    return;
  }
  if (
    e.altKey &&
    !e.ctrlKey &&
    !e.metaKey &&
    !e.shiftKey &&
    (e.code === "ArrowUp" || e.code === "ArrowDown")
  ) {
    // 已经在头 / 尾也要拦下来：免得平台把 Alt+↑↓ 当作窗口级操作
    e.preventDefault();
    moveCurrentLine(e.code === "ArrowUp" ? -1 : 1);
  }
}

/** Ctrl+D：删掉光标所在行；**选中多行时删掉整个选区**（只读一次原生选区，不引入"行选区"） */
function deleteCurrentLine(): void {
  const el = editor.value;
  if (!el) return;
  const range = selectionLines(el.value, el.selectionStart, el.selectionEnd);
  if (range === null) {
    const index = caretLine(el.value, el.selectionStart).index;
    deleteLinesAt(index, index);
    return;
  }
  deleteLinesAt(range.first, range.last);
}

/**
 * 删掉 `[first, last]` 这一段逻辑行：**快捷键 `Ctrl+D`、右键菜单、行内「删除当前行」按钮
 * 三条入口共用**（都走 `applyEdit`，因此都能 `Ctrl+Z` 撤回、都不做二次确认）。
 * 单行是它的退化 —— 走 `deleteLine`（同一份规则的薄封装）。
 */
function deleteLinesAt(first: number, last: number): void {
  const el = editor.value;
  if (!el) return;
  const text = el.value;
  const from = el.selectionStart;
  const { start, end, caret } =
    first === last ? deleteLine(text, first) : deleteLines(text, first, last);
  if (start === end) return; // 空文档：没有可删的
  // 颜色跟着这几行一起删，别串到后面的行；交给 applyEdit 记快照供撤销恢复
  applyEdit(
    `${text.slice(0, start)}${text.slice(end)}`,
    { start: caret, end: caret },
    from,
    spliceColors(paddedColors(), first, last),
  );
  log.info(
    first === last
      ? `[notes] 删除第 ${first + 1} 行`
      : `[notes] 删除第 ${first + 1}–${last + 1} 行`,
  );
}

/** 行内「删除当前行」按钮走它：只删那一行（按钮属于那一行、**不跟随选区**，见 `design.md` 行内操作） */
function deleteLineAt(index: number): void {
  deleteLinesAt(index, index);
}

/**
 * 右键菜单第三项：**整篇**清除连续空行（连续 ≥2 个空行各留一个）。
 * 纯函数返回 `null` 就什么都不做 —— 不写盘、不进撤销栈、光标也不动；真压了则与其它结构性编辑
 * 同一条路（`applyEdit` → 可 `Ctrl+Z` 撤回），光标由纯函数按内容锚定。
 */
function collapseAllBlankLines(): void {
  const el = editor.value;
  if (!el) return;
  const from = el.selectionStart;
  const collapsed = collapseBlankLines(el.value, from);
  if (collapsed === null) return;
  // 清除连续空行是整篇操作、可能有多段：`moved` 是纯函数算好的旧→新行号映射，
  // 颜色照它重排即可（被压掉的空行归到段内留下来的那个空行），不用再猜插入点。
  const nextColors = remapColors(
    paddedColors(),
    collapsed.moved,
    collapsed.text.split("\n").length,
  );
  applyEdit(collapsed.text, { start: collapsed.caret, end: collapsed.caret }, from, nextColors);
  log.info("[notes] 已清除连续空行");
}

/**
 * 复制 `[first, last]` 这一段逻辑行的文本到剪贴板（**不改文档**）：行内按钮与右键菜单共用
 * （快捷键不管复制 —— 那是浏览器原生的 `Ctrl+C`，见 `design.md` 选择与复制）。
 * 优先异步剪贴板 API；它在权限 / 焦点不满足时会抛，于是回落到「临时选中这几行 + execCommand("copy")」
 * 并把原选区还回去 —— 两条路都留着，避免环境差异变成静默失败。
 * **返回是否真的复制成功**：行内按钮据此给对勾 / 叉（见 `copyFeedback`）。
 */
async function copyLines(first: number, last: number): Promise<boolean> {
  const el = editor.value;
  if (!el || first < 0 || last >= lines.value.length) return false;
  const text = lines.value.slice(first, last + 1).join("\n");
  let ok: boolean;
  try {
    await navigator.clipboard.writeText(text);
    ok = true;
  } catch (e) {
    const start = lineRange(el.value, first).start;
    const end = lineRange(el.value, last).end;
    const restore = el.selectionStart;
    el.setSelectionRange(start, end);
    ok = document.execCommand("copy");
    el.setSelectionRange(restore, restore);
    log.warn(
      `[notes] 剪贴板 API 不可用，已回落 execCommand（${ok ? "成功" : "失败"}）：${String(e)}`,
    );
  }
  if (!ok) {
    log.error("[notes] 复制失败：两条剪贴板路径都没成");
    return false;
  }
  log.info(
    first === last
      ? `[notes] 已复制第 ${first + 1} 行`
      : `[notes] 已复制第 ${first + 1}–${last + 1} 行`,
  );
  return true;
}

/**
 * 复制的**原地短反馈**（1.2s）：按钮图标临时换成对勾 / 叉，尺寸与位置都不变 ——
 * 不新增浮层（行尾已经够挤，见 `design.md`「行内操作」的已知代价）。
 * 反馈绑在「发起时那一行」上：换行后 `copyState` 自然变 null，不会把对勾留在别的行。
 */
const copyFeedback = ref<{ line: number; ok: boolean } | null>(null);
let copyTimer: ReturnType<typeof setTimeout> | null = null;

const copyState = computed<"ok" | "fail" | null>(() => {
  const feedback = copyFeedback.value;
  if (feedback === null || feedback.line !== currentLine.value) return null;
  return feedback.ok ? "ok" : "fail";
});

function flashCopyFeedback(line: number, ok: boolean): void {
  copyFeedback.value = { line, ok };
  if (copyTimer !== null) clearTimeout(copyTimer);
  copyTimer = setTimeout(() => {
    copyTimer = null;
    copyFeedback.value = null;
  }, 1_200);
}

/// 行内「复制当前行」：先写剪贴板，再把结果反馈到按钮上
async function copyCurrentLine(): Promise<void> {
  const line = currentLine.value;
  flashCopyFeedback(line, await copyLines(line, line));
}

// ── 右键菜单：复制 / 删除（多行时作用于整个选区）────────────────────────────────
// 命中规则**不自己算几何**：Chromium 右键点在选区外时原生就把插入符挪到点击处、点在选区内则
// 保留选区 —— 所以「读一次 selectionStart/End」就等价于「选区内 → 整个选区 / 选区外 → 那一行」。

const contextMenu = ref<{ x: number; y: number; first: number; last: number } | null>(null);

/// 菜单项：无选区是「当前行」、有选区是「N 行」；两项都复用上面的删除 / 复制实现
const menuItems = computed(() => {
  const menu = contextMenu.value;
  if (menu === null) return [];
  const scope = menu.last > menu.first ? ` ${menu.last - menu.first + 1} 行` : "当前行";
  return [
    {
      label: `复制${scope}`,
      onPick: () => {
        void copyLines(menu.first, menu.last);
        closeContextMenu();
      },
    },
    {
      label: `删除${scope}`,
      danger: true,
      onPick: () => {
        deleteLinesAt(menu.first, menu.last);
        closeContextMenu();
      },
    },
    {
      // **整篇**清理，与选区无关（与上面两项唯一的差别，见 `design.md` 右键菜单节）
      label: "清除连续空行",
      onPick: () => {
        collapseAllBlankLines();
        closeContextMenu();
      },
    },
  ];
});

function closeContextMenu(): void {
  contextMenu.value = null;
}

/// 右键：摆到指针处（越界由 `ContextMenu` 自己夹），范围按**此刻**的选区算
function onContextMenu(e: MouseEvent): void {
  const el = editor.value;
  if (!el) return;
  e.preventDefault();
  const range = selectionLines(el.value, el.selectionStart, el.selectionEnd);
  const first = range?.first ?? caretLine(el.value, el.selectionStart).index;
  contextMenu.value = { x: e.clientX, y: e.clientY, first, last: range?.last ?? first };
}

/// 点窗口任何地方都收（菜单卡片自己 `@pointerdown.stop`，所以点菜单项不会被这里先摘掉）
function onDocumentPointerDown(): void {
  closeContextMenu();
  paletteFor.value = null; // 色板同理：点别处就收（色板自己 `@pointerdown.stop`）
}

/**
 * Alt+↑/↓：与相邻行交换，光标跟着这一行走、列保持不变；已在头 / 尾则不动。
 * **选中多行时整块移动一行**，并把选区一起平移 —— 否则连按第二次就只剩一行可动（见 `design.md`）。
 */
function moveCurrentLine(delta: number): void {
  const el = editor.value;
  if (!el) return;
  const text = el.value;
  const from = el.selectionStart;
  const parts = text.split("\n");

  const range = selectionLines(text, el.selectionStart, el.selectionEnd);
  if (range !== null) {
    const moved = moveLines(parts, range.first, range.last, delta);
    if (moved === null) return; // 块已顶到首行 / 底到末行
    // 颜色按同一套置换跟着块走（颜色数组先补齐到行数，否则 moveLines 会夹错边界）
    const nextColors = moveLines(paddedColors(), range.first, range.last, delta);
    // 块整体平移一行 = 选区按「相邻那一行 + 它的换行」平移（换行跟着那一行一起被搬走）
    const neighbour =
      delta < 0 ? parts[range.first - 1].length + 1 : parts[range.last + 1].length + 1;
    const shift = delta < 0 ? -neighbour : neighbour;
    const next = moved.join("\n");
    applyEdit(
      next,
      { start: el.selectionStart + shift, end: el.selectionEnd + shift },
      from,
      nextColors ?? undefined,
    );
    log.info(
      `[notes] 第 ${range.first + 1}–${range.last + 1} 行整块移到第 ${range.first + 1 + delta} 行`,
    );
    return;
  }

  const { index, column } = caretLine(text, from);
  const target = index + delta;
  if (target < 0 || target >= parts.length) return;
  const next = moveItem(parts, index, target).join("\n");
  const caret = caretOffset(next, target, column);
  applyEdit(next, { start: caret, end: caret }, from, moveItem(paddedColors(), index, target));
  log.info(`[notes] 第 ${index + 1} 行移到了第 ${target + 1} 行`);
}

/**
 * 落地一次结构性编辑（整份文本替换）。**所有**结构性编辑都走这里：Ctrl+D、Alt+↑/↓、
 * 行内「删除当前行」按钮、拖拽落盘 —— 一份实现、一份坑、一份测试口径。
 *
 * 优先走 `document.execCommand("insertText")`：它把这一笔并进浏览器自己的撤销栈，于是
 * **Ctrl+Z 能把「删掉一行 / 移走一行 / 拖拽搬动」撤回来**；直接改 value 是进不了撤销栈的，
 * 而且会把插入符甩到文末（取舍见 `design.md`，机制见 `开发经验.md` §3.9）。execCommand 万一不可用
 * （返回 false）就回落为直接写。
 *
 * `target` 是编辑后该落的**选区**（`start === end` 就是光标；多行整块移动时这里是一整块，见
 * `moveCurrentLine`）；`from` 是编辑前光标的位置 —— 撤销会连「编辑前的选区」一起恢复
 * （而我们是全选后替换，于是撤销后整篇被选中），届时用它把光标放回原处并取消选区（见 `onInput`）。
 */
function applyEdit(
  text: string,
  target: { start: number; end: number },
  from: number,
  nextColors?: LineColor[],
): void {
  const el = editor.value;
  if (!el) return;
  // 颜色快照在搬色**之前**取：撤销 / 重放时把这份旁路状态一起带回来
  const colorsBefore = lineColors.colors.value.slice();
  if (nextColors !== undefined) lineColors.replace(nextColors);
  const colorsAfter = lineColors.colors.value.slice();
  // 结构性编辑已经自己搬过颜色：execCommand 同步派发的那次 input 别再平移一次
  skipColorReconcile = true;
  // 键盘路径本来就在焦点里；鼠标拖拽可能没有（用户可能一直没点进编辑器），而 execCommand
  // 只作用于聚焦元素 —— 先聚焦，顺带让拖完的光标看得见。
  el.focus();
  el.setSelectionRange(0, el.value.length);
  if (!document.execCommand("insertText", false, text)) {
    el.value = text; // 先落到 DOM，保证下面设置光标时作用在新文本上
    setContent(text);
  }
  skipColorReconcile = false; // 回落路径不派发 input，兜底清掉
  el.setSelectionRange(target.start, target.end);
  preEditCaret = from; // 放在最后：否则会被本次编辑自己触发的 input 清掉
  // 记下这一笔「编辑后」的样子：用户撤销后再重做时，就按它重放一次（缘由见 `structural` 的注释）。
  // 也必须放在 execCommand 之后 —— 那一步会同步触发 input，先写会被 onInput 清掉。
  structural = {
    after: text,
    targetBefore: { start: from, end: from },
    targetAfter: target,
    colorsBefore,
    colorsAfter,
    state: "applied",
    depth: 0,
  };
  syncCaretLine(); // 程序化改光标不一定触发 selectionchange，这里补一次，当前行立刻跟上
  flushNow();
}

/**
 * 用外部文本整份替换（导入笔记备份用）：走同一个 `applyEdit`，于是这一笔也在浏览器撤销栈里
 * （主面板可 Ctrl+Z 撤销）。光标落在文首 —— 导入后用户看到的是新内容的开头。
 */
function replaceAll(text: string): void {
  applyEdit(text, { start: 0, end: 0 }, 0);
}

defineExpose({ replaceAll });

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

function flashDropped(first: number, last: number): void {
  droppedRange.value = { first, last };
  if (dropTimer !== null) clearTimeout(dropTimer);
  dropTimer = setTimeout(() => {
    dropTimer = null;
    droppedRange.value = null;
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
    @scroll="closeContextMenu"
  >
    <!-- 背景装饰层：必须在 textarea **之下** —— 当前行高亮是「给这一行铺底色」，
         而不是「给文字蒙一层灰」。画在文字之上的半透明色块会把文字一起压暗，
         读起来像整行失焦（见 `开发经验.md` §3.3）。 -->
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
      <!-- 行颜色：左侧 2px 强调条，按实测行盒绘制（折行时铺满整块）。画在"当前行"之后，
           于是当前行既被标记过颜色时看到的是**那个颜色**，当前行的极淡底色照旧在。 -->
      <div
        v-for="bar in coloredBars"
        :key="bar.index"
        class="absolute border-l-2"
        :data-line-color="bar.index"
        :style="{
          borderColor: bar.color,
          top: `${boxTop(bar.index)}px`,
          height: `${boxHeight(bar.index)}px`,
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
      <!-- 被拿起来的块（可能是多行）：**有意**做成盖在文字上的色罩（「这块被搬走了」本该灰下去）；
           再加虚线上下沿，让「搬走的是这一整块」有明确起止（折行块可以很高，只靠色罩边界发虚） -->
      <div
        v-if="drag"
        data-drag-source
        class="absolute inset-x-0 border-y border-dashed"
        :style="{
          borderColor: 'var(--note-fg-faint)',
          backgroundColor: 'var(--note-fg-veil)',
          top: `${boxTop(drag.first)}px`,
          height: `${boxTop(drag.last) + boxHeight(drag.last) - boxTop(drag.first)}px`,
        }"
      />
      <!-- 松手落点闪一下（220ms 淡出）：整块圈上 -->
      <div
        v-if="droppedRange !== null"
        class="drop-flash absolute inset-x-0 bg-sky-400/20"
        :style="{
          top: `${boxTop(droppedRange.first)}px`,
          height: `${boxTop(droppedRange.last) + boxHeight(droppedRange.last) - boxTop(droppedRange.first)}px`,
        }"
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
           仍然是「指针停在这一行时才显形」。拖动中只留被抓住那一行的手柄 —— 整块范围已由
           上面的源行罩交代，不必再亮起一排。 -->
      <button
        v-for="(_, index) in lines"
        :key="index"
        type="button"
        class="pointer-events-auto absolute flex cursor-grab touch-none items-center justify-center overflow-hidden transition-opacity active:cursor-grabbing"
        :class="index === hoverIndex || index === drag?.grabIndex ? 'opacity-100' : 'opacity-0'"
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
        <!-- 字形不许参与命中：小行高时它的行盒会溢出按钮盒，抢到邻行的点击（见 §3.19） -->
        <span class="pointer-events-none leading-none">⠿</span>
      </button>
      <!-- 当前行右侧的行操作：绝对定位浮在文字上，不占任何布局空间；
           只在指针停在这一行时露头（鼠标指哪就说明在看哪），拖拽中藏起来免得误点 -->
      <!-- 按钮本身仍是一行高（不该在长行上变胖），所以放在行盒里**竖直居中**。
           `right: 24px` 是给**次级面板那颗圆把手**让位：它圆心锚在主面板右边界、直径 20px，
           贴着右缘（关闭态）正好占到 x ∈ [W−20, W]，所以按钮组右缘要退到 W−24 才留得出缝
           （两者都靠右，只能让按钮组让开；代价见 design.md「行内操作」）。 -->
      <div
        v-if="showRowActions"
        class="absolute flex items-center gap-0.5"
        :style="{
          top: `${boxTop(currentLine) + (boxHeight(currentLine) - ROW_H) / 2}px`,
          right: '24px',
          height: `${ROW_H}px`,
        }"
      >
        <button
          type="button"
          class="pointer-events-auto flex h-5 w-5 items-center justify-center rounded bg-[var(--note-bg)] text-[var(--note-fg)] ring-1 ring-[var(--note-fg-weak)] transition hover:ring-[var(--note-fg-faint)]"
          aria-label="复制当前行"
          title="复制当前行"
          :data-copy-state="copyState ?? undefined"
          @mousedown.prevent
          @click="copyCurrentLine()"
        >
          <!-- 成功 → 绿色对勾（emerald-600：与设置面板开关同一档，浅色底上也看得清）；
               失败 → 叉（rose-500，与删除 hover 同一支红色）。颜色只挂在图标上，
               避开与按钮底色 / 描边那两族 utility 抢同一属性。 -->
          <svg
            v-if="copyState === 'ok'"
            class="text-emerald-600"
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
            class="text-rose-500"
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
        <!-- 屏幕阅读器播报（按钮的 `aria-label` 保持不变：语义定位与语音控制都靠它） -->
        <span class="sr-only" aria-live="polite">
          {{ copyState === "ok" ? "已复制" : copyState === "fail" ? "复制失败" : "" }}
        </span>
        <!-- 行颜色：与复制 / 删除同一条浮条，点它开色板（作用在**当前行**，不跟随悬停行）。
             排在复制之后、删除之前：复制最高频，放最左；删除有破坏性，留最右。 -->
        <button
          type="button"
          class="pointer-events-auto flex h-5 w-5 items-center justify-center rounded bg-[var(--note-bg)] text-[var(--note-fg)] ring-1 ring-[var(--note-fg-weak)] transition hover:ring-[var(--note-fg-faint)]"
          aria-label="行颜色"
          title="行颜色"
          aria-haspopup="dialog"
          :aria-expanded="paletteFor === currentLine"
          @mousedown.prevent
          @click="openPalette($event, currentLine)"
        >
          <span
            class="h-2.5 w-2.5 rounded-full ring-1 ring-[var(--note-fg-faint)]"
            :style="{ backgroundColor: lineColors.colorAt(currentLine) ?? 'transparent' }"
          />
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
      @contextmenu="onContextMenu"
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

  <!-- 幽灵行：正被拿着的**整块**（可能是多行），跟手贴着指针（fixed 定位，不参与文本流）。
       从被抓的那一行开始渲最多 GHOST_MAX_ROWS 行：块再大也不撑出窗口，总行数由角标交代。
       底色用**颜色 alpha**（不是 `opacity-*`）留 10% 透光：只为看清下面那一行的字、好判断落点，
       文字与描边保持实心；插入线的可见性由它自己的 z-[60] 层保证，不靠这里透出来（见 design.md「叠层」）。 -->
  <div
    v-if="drag"
    data-drag-ghost
    class="pointer-events-none fixed z-50 flex flex-col overflow-hidden rounded bg-[var(--note-bg)] shadow-xl ring-1 ring-[var(--note-fg-weak)]"
    :style="{
      top: `${drag.pointerY - drag.grabOffset}px`,
      left: `${drag.ghostLeft}px`,
      width: `${drag.ghostWidth}px`,
      height: `${ghostRows.length * ROW_H}px`,
    }"
  >
    <div
      v-for="(line, row) in ghostRows"
      :key="row"
      class="flex items-center"
      :style="{ height: `${ROW_H}px` }"
    >
      <span
        class="flex shrink-0 justify-center text-[var(--note-fg-faint)]"
        :style="{ width: `${HANDLE_W + 2}px` }"
      >
        {{ row === 0 ? "⠿" : "" }}
      </span>
      <span
        class="min-w-0 flex-1 truncate px-1 text-[var(--note-fg)]"
        :style="{ fontSize: 'var(--note-font-size)' }"
      >
        {{ line }}
      </span>
      <span
        v-if="row === 0 && dragBlockSize > 1"
        class="shrink-0 pr-2 text-[10px] text-[var(--note-fg-faint)]"
      >
        {{ dragBlockSize }} 行
      </span>
    </div>
  </div>

  <!-- 右键菜单：自绘浮层（系统菜单已由 `main.ts` 全局关掉）。位置由它自己夹（见 `ContextMenu.vue`），
       菜单项与动作全由这里组装 —— 只有这里知道选区覆盖哪几行。 -->
  <!-- 行颜色色板：fixed 浮层（不受 scroller 的滚动裁剪），层级 z-40 与右键菜单同档。
       第一项「默认」= 清掉这一行的颜色；选完即关，点别处 / Esc 也关。 -->
  <div
    v-if="paletteFor !== null"
    class="fixed z-40 grid grid-cols-5 gap-1 rounded-lg border border-slate-700 bg-slate-800 p-2 shadow-xl"
    :style="{ left: `${palettePos.x}px`, top: `${palettePos.y}px` }"
    role="dialog"
    aria-label="行颜色"
    @pointerdown.stop
  >
    <button
      v-for="item in LINE_COLORS"
      :key="item.label"
      type="button"
      class="flex h-5 w-5 items-center justify-center rounded ring-1"
      :class="
        lineColors.colorAt(paletteFor) === item.value ? 'ring-[var(--note-fg)]' : 'ring-transparent'
      "
      :aria-label="item.label"
      :title="item.label"
      @mousedown.prevent
      @click="pickLineColor(item.value)"
    >
      <span
        class="h-3 w-3 rounded-full"
        :style="{
          backgroundColor: item.value === null ? 'var(--note-fg-faint)' : item.value,
        }"
      />
    </button>
  </div>

  <ContextMenu v-if="contextMenu" :x="contextMenu.x" :y="contextMenu.y" :items="menuItems" />
</template>
