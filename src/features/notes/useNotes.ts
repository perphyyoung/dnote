// 每块面板各有一份「整份笔记」（= 该面板那个文件的内容本身）：编辑与拖拽都在前端完成，
// 改动后整文件重写落盘（后端 save_notes，原子写）。
//
// 为什么是「一个字符串 + 一个 <textarea>」，而不是「行数组 + 每行一个 <input>」：
// 后者意味着回车不拆行、退格不合并、↑↓ 不能在行间移动、Ctrl+Z 只管当前那一格、多行拖选
// 只能退化成整行选中 —— 这些全得自研且永远差一口气。交给一个 <textarea>，浏览器就把
// 「普通记事本」的编辑语义（含多行选区、Ctrl+A、Ctrl+Z）全包了；我们只接管这一层真正
// 独有的东西：拖拽行排序与落盘。
//
// **模块级单例，但每个面板一份**（抄 cdown useCountdown 的模式）：App.vue 与 NoteEditor.vue
// 拿着同一个面板名调 useNotes()，拿到的是同一份 content；换一个面板名就是另一份、另一个文件。
// 两块面板因此共用同一套代码，却彼此独立 —— 内容、防抖队列、保存错误都不串。

import { computed, ref } from "vue";
import type { Ref } from "vue";
import type { Panel } from "@/bindings";
import { commands } from "@/bindings";
import { log } from "@/utils/logger";

export type { Panel };

/** 连续输入停顿多久后落盘；拖拽结束 / 失焦走 flushNow 立即写 */
const SAVE_DEBOUNCE_MS = 400;

/// 一块面板的笔记状态与操作。同一个 `panel` 永远拿到同一个实例。
export interface Notes {
  /** 与面板那个文件逐字一致的文本：行序即上下顺序，空行原样保留 */
  content: Ref<string>;
  /** 行数组：只给「拖拽行排序」当视图用（手柄按行排布），事实源仍是 content */
  lines: Ref<string[]>;
  ready: Ref<boolean>;
  error: Ref<string | null>;
  /** 文本编辑：防抖落盘（textarea 的每次输入，拆行 / 合并 / 粘贴都由原生改好文本） */
  setContent(text: string): void;
  /** 立即落盘并取消挂起的防抖（拖拽结束 / 失焦走这里） */
  flushNow(): void;
}

function createNotes(panel: Panel): Notes {
  const content = ref("");
  const ready = ref(false);
  const error = ref<string | null>(null);

  const lines = computed(() => content.value.split("\n"));

  // ── 落盘 ──────────────────────────────────────────────────────────────────
  // 用 promise 链串行化写入：调用按入队顺序执行，且执行时才取当前 content，
  // 因此最后一次入队的写入一定是最新内容（不会出现旧内容后到、覆盖新内容）。
  // 链是**每个面板一条**：两块面板同时打字也各写各的文件，互不排队。
  let chain: Promise<void> = Promise.resolve();
  let timer: ReturnType<typeof setTimeout> | null = null;

  function flush(): Promise<void> {
    chain = chain.then(async () => {
      try {
        await commands.saveNotes(panel, lines.value);
        error.value = null;
      } catch (e) {
        error.value = String(e);
        log.error(`[notes:${panel}] 保存失败`, e);
      }
    });
    return chain;
  }

  function scheduleSave(): void {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void flush();
    }, SAVE_DEBOUNCE_MS);
  }

  function flushNow(): void {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    void flush();
  }

  // ── 读取 ──────────────────────────────────────────────────────────────────
  async function load(): Promise<void> {
    try {
      // 后端给的是「行」；拼回文本就是界面上那份内容（空文件 → 空文本 → 空 textarea）
      content.value = (await commands.loadNotes(panel)).join("\n");
      error.value = null;
    } catch (e) {
      error.value = String(e);
      log.error(`[notes:${panel}] 读取失败`, e);
    } finally {
      ready.value = true;
    }
  }

  // ── 编辑 ──────────────────────────────────────────────────────────────────
  function setContent(text: string): void {
    if (content.value === text) return;
    content.value = text;
    scheduleSave();
  }

  // 单窗口应用：模块加载即读取一次，不挂生命周期钩子。**读取不创建文件**，
  // 所以次级面板藏着的时候不会凭空多出一个空文件。
  void load();

  return { content, lines, ready, error, setContent, flushNow };
}

/// 两块面板的实例在模块加载时就各建一份（两者都只是读一次文件，代价可忽略）
const instances: Record<Panel, Notes> = {
  main: createNotes("main"),
  secondary: createNotes("secondary"),
};

/** 取某块面板的笔记状态；不传就是主面板（老调用点的默认行为不变） */
export function useNotes(panel: Panel = "main"): Notes {
  return instances[panel];
}
