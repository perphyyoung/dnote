// 整个记事本的内容（= dnote.txt 的内容本身）是唯一事实源：编辑与拖拽都在前端完成，
// 改动后整文件重写落盘（后端 save_notes，原子写）。
//
// 为什么是「一个字符串 + 一个 <textarea>」，而不是「行数组 + 每行一个 <input>」：
// 后者意味着回车不拆行、退格不合并、↑↓ 不能在行间移动、Ctrl+Z 只管当前那一格、多行拖选
// 只能退化成整行选中 —— 这些全得自研且永远差一口气。交给一个 <textarea>，浏览器就把
// 「普通记事本」的编辑语义（含多行选区、Ctrl+A、Ctrl+Z）全包了；我们只接管这一层真正
// 独有的东西：拖拽行排序与落盘。
//
// 模块级单例状态（抄 cdown useCountdown 的模式）：App.vue 与 NoteEditor.vue
// 调的是同一个 useNotes()，拿到的是同一份 content。

import { computed, nextTick, ref } from "vue";
import { commands } from "@/bindings";
import { log } from "@/utils/logger";

/** 连续输入停顿多久后落盘；拖拽结束 / 失焦走 flushNow 立即写 */
const SAVE_DEBOUNCE_MS = 400;

/** 与 dnote.txt 逐字一致的文本：行序即上下顺序，空行原样保留 */
const content = ref("");
const ready = ref(false);
const error = ref<string | null>(null);

/** 行数组：只给「拖拽行排序」当视图用（手柄按行排布），事实源仍是 content */
const lines = computed(() => content.value.split("\n"));

/** 编辑器元素由 NoteEditor 注册：header 的「＋」要能聚焦并把光标落到末尾 */
let editorEl: HTMLTextAreaElement | null = null;

/** NoteEditor 挂载 / 卸载时登记自己的 textarea（卸载传 null） */
export function registerEditor(el: HTMLTextAreaElement | null): void {
  editorEl = el;
}

// ── 落盘 ────────────────────────────────────────────────────────────────────
// 用 promise 链串行化写入：调用按入队顺序执行，且执行时才取当前 content，
// 因此最后一次入队的写入一定是最新内容（不会出现旧内容后到、覆盖新内容）。
let chain: Promise<void> = Promise.resolve();
let timer: ReturnType<typeof setTimeout> | null = null;

function flush(): Promise<void> {
  chain = chain.then(async () => {
    try {
      await commands.saveNotes(lines.value);
      error.value = null;
    } catch (e) {
      error.value = String(e);
      log.error("[notes] 保存失败", e);
    }
  });
  return chain;
}

/** 防抖落盘：连续打字只写一次（纯文本编辑走这里） */
function scheduleSave(): void {
  if (timer !== null) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void flush();
  }, SAVE_DEBOUNCE_MS);
}

/** 立即落盘并取消挂起的防抖（拖拽结束 / 失焦走这里） */
export function flushNow(): void {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  void flush();
}

// ── 读取 ────────────────────────────────────────────────────────────────────
async function load(): Promise<void> {
  try {
    // 后端给的是「行」；拼回文本就是界面上那份内容（空文件 → 空文本 → 空 textarea）
    content.value = (await commands.loadNotes()).join("\n");
    error.value = null;
  } catch (e) {
    error.value = String(e);
    log.error("[notes] 读取失败", e);
  } finally {
    ready.value = true;
  }
}

// ── 编辑与结构操作 ──────────────────────────────────────────────────────────
/** 文本编辑：防抖落盘（textarea 的每次输入，拆行 / 合并 / 粘贴都由原生改好文本） */
export function setContent(text: string): void {
  if (content.value === text) return;
  content.value = text;
  scheduleSave();
}

/**
 * 拖拽重排后写回整份文本。
 * 拖拽过程中每次换位都会调它（乐观更新），落盘压成一次：松手时由调用方 `flushNow`。
 */
export function setLines(next: readonly string[]): void {
  content.value = next.join("\n");
  scheduleSave();
}

/** 末尾追加一个空行并聚焦（header 的「＋」）：等价于把光标放到末尾再按回车 */
export function appendLine(): void {
  content.value = `${content.value}\n`;
  scheduleSave();
  void nextTick(() => {
    const el = editorEl;
    if (!el) return;
    el.focus();
    const end = el.value.length;
    el.setSelectionRange(end, end);
  });
}

// 单窗口应用：模块加载即读取一次，不挂生命周期钩子
void load();

export function useNotes() {
  return { content, lines, ready, error, setContent, setLines, appendLine };
}
