/**
 * 拖拽调序：按住行首悬停出现的手柄上下拖动，行序跟着指针走，松手落盘。
 *
 * 编辑语义都交给了浏览器，**拖拽是本项目唯一自研的交互**，所以它必须有自己的 e2e
 * （此前只有 vitest 覆盖了纯函数 dropIndex / moveItem，没人验证过手柄与指针这条链路）。
 *
 * 断言口径：既看界面上的行序，也核对落盘的 `dnote.txt` —— 拖拽中只改前端状态，
 * 必须在松手那一刻落盘。
 */
import { expect } from "@playwright/test";
import {
  caretTo,
  dragLine,
  dragLineWith,
  editorText,
  expectPersistedLines,
  readPersistedLines,
  seedLines,
  selection,
  test,
} from "./e2e-helpers";
import { e2eLog } from "./e2e-logger";

const LINES = ["第一行", "第二行", "第三行"];

/// 长笔记（11 行 / 74 字符，首尾都有空行）：Chromium 的重做缺陷只在「长 + 多行」的整篇替换上出现，
/// 短笔记（LINES 那三条）恰好落在正常的那一档 —— 两种规模都要有用例守着。
const LONG_NOTE = [
  "",
  "横向滚动条",
  "最大化",
  "自适应宽高",
  "自定义行颜色",
  "ctrl+d 快捷键删除",
  "alt+上下箭头 移动行",
  "箭头位于行首时，直接在当前位置插入新行",
  "置顶",
  "",
  "",
];
/// 把第 2 行（下标 1）拖到末尾后的行
const LONG_MOVED = [LONG_NOTE[0], ...LONG_NOTE.slice(2, 10), LONG_NOTE[1], LONG_NOTE[10]];

test.describe("拖拽调整行序", () => {
  test.beforeEach(async ({ app, page }) => {
    await seedLines(app, page, LINES);
  });

  test("按住第一行的手柄往下拖到最后", async ({ page, app }) => {
    await dragLine(page, 0, 2);

    const text = await editorText(page);
    e2eLog.info("[drag] 往下拖后的内容", text);

    expect(text).toBe("第二行\n第三行\n第一行");
    await expectPersistedLines(app.dataDir, ["第二行", "第三行", "第一行"]);
  });

  test("按住最后一行的手柄往上拖到最前", async ({ page, app }) => {
    await dragLine(page, 2, 0);

    expect(await editorText(page)).toBe("第三行\n第一行\n第二行");
    await expectPersistedLines(app.dataDir, ["第三行", "第一行", "第二行"]);
  });

  test("拖到半行以内不换位（阈值）", async ({ page, app }) => {
    // 只移动小于半行高的距离：指针仍在原来那一行，插入位等于「没动」
    await dragLineWithinHalfRow(page);

    expect(await editorText(page)).toBe(LINES.join("\n"));
    await expectPersistedLines(app.dataDir, LINES);
  });

  test("拖拽后光标跟着被拖的那一行，不会跳到文末", async ({ page }) => {
    await caretTo(page, 0, 2); // 当前行 = 第 1 行第 2 列
    await dragLine(page, 0, 2); // 把它拖到最后

    expect(await editorText(page)).toBe("第二行\n第三行\n第一行");
    // 被拖的那一行现在是第 3 行：光标应停在第 3 行第 2 列（"第二行\n第三行\n" = 8，+2 = 10），
    // 而不是被直接改 value 甩到文末（那会得到 { start: 11, end: 11 }）
    expect(await selection(page)).toEqual({ start: 10, end: 10 });
    await expect(page.locator("[data-caret-line]")).toHaveAttribute("data-caret-line", "2");
  });

  test("拖别的行时，光标留在原来那一行内容上", async ({ page }) => {
    await caretTo(page, 2, 1); // 当前行 = 第 3 行「第三行」
    await dragLine(page, 0, 2); // 把第 1 行拖到最后

    // 内容变成 第二行 / 第三行 / 第一行：原来第 3 行的「第三行」被顶到第 2 行，光标跟着它到 (1, 1)
    expect(await selection(page)).toEqual({ start: 5, end: 5 });
  });

  test("拖拽搬动也能 Ctrl+Z 撤回来（与快捷键同一条实现路径）", async ({ page, app }) => {
    await caretTo(page, 0, 1);
    await dragLine(page, 0, 2);
    expect(await editorText(page)).toBe("第二行\n第三行\n第一行");
    await expectPersistedLines(app.dataDir, ["第二行", "第三行", "第一行"]);

    await page.keyboard.press("Control+z");
    expect(await editorText(page)).toBe(LINES.join("\n"));
    await expectPersistedLines(app.dataDir, LINES);
    // 撤销后光标回到拖拽前的位置，且没有选区（撤销会恢复编辑前的选区，applyEdit 已处理）
    expect(await selection(page)).toEqual({ start: 1, end: 1 });
  });

  test("短笔记：拖拽 → Ctrl+Z → Ctrl+Y 精确往返（这一档 Chromium 是对的）", async ({
    page,
    app,
  }) => {
    await caretTo(page, 0, 1);
    await dragLine(page, 0, 2);
    const moved = "第二行\n第三行\n第一行";
    expect(await editorText(page)).toBe(moved);

    await page.keyboard.press("Control+z");
    expect(await editorText(page)).toBe(LINES.join("\n"));

    await page.keyboard.press("Control+y");
    expect(await editorText(page)).toBe(moved);
    await expectPersistedLines(app.dataDir, ["第二行", "第三行", "第一行"]);
  });

  test("长笔记：拖拽 → Ctrl+Z → Ctrl+Y 后必须与搬动后逐字一致（修复前会丢一行）", async ({
    page,
    app,
  }) => {
    // 规模是这条用例的必要条件：短笔记（3~5 行）走的是同一段代码，却恰好落在 Chromium 正常的那一档，
    // 只有到 11 行 / 74 字符这个量级，重做才会按错误的前后缀拼回文本（实测丢一整行，详见 `开发经验.md`）。
    // 所以别为了「简洁」把这堆行缩成三行 —— 那样就复现不出来了。
    await seedLines(app, page, LONG_NOTE);
    await caretTo(page, 1, 0);
    await dragLine(page, 1, 9);
    expect(await editorText(page)).toBe(LONG_MOVED.join("\n"));

    await page.keyboard.press("Control+z");
    expect(await editorText(page)).toBe(LONG_NOTE.join("\n"));

    await page.keyboard.press("Control+y");
    expect(await editorText(page)).toBe(LONG_MOVED.join("\n"));
    await expectPersistedLines(app.dataDir, LONG_MOVED);
  });

  test("长笔记：Ctrl+Shift+Z 是另一个重做键位，同样必须精确", async ({ page, app }) => {
    await seedLines(app, page, LONG_NOTE);
    await caretTo(page, 1, 0);
    await dragLine(page, 1, 9);

    await page.keyboard.press("Control+z");
    expect(await editorText(page)).toBe(LONG_NOTE.join("\n"));

    await page.keyboard.press("Control+Shift+z");
    expect(await editorText(page)).toBe(LONG_MOVED.join("\n"));
  });

  test("长笔记：撤掉拖拽后接着撤掉打字，再连重做两笔也都精确", async ({ page, app }) => {
    // 撤销栈里我们那一笔下面还有「打字」那一笔：重做要先让浏览器重放打字，轮到我们时才由我们重放
    // （`structural.depth` 就是这个用途，见 NoteEditor.vue）
    await seedLines(app, page, LONG_NOTE);
    await caretTo(page, 0, 0);
    await page.keyboard.type("※");
    // 打字把首行（本来是空行）变成了「※」，行数不变
    const typed = ["※", ...LONG_NOTE.slice(1)].join("\n");

    await caretTo(page, 1, 0);
    await dragLine(page, 1, 9);
    const moved = ["※", ...LONG_MOVED.slice(1)].join("\n");
    expect(await editorText(page)).toBe(moved);

    await page.keyboard.press("Control+z"); // 撤掉拖拽（我们那一笔）
    expect(await editorText(page)).toBe(typed);
    await page.keyboard.press("Control+z"); // 再撤掉打字
    expect(await editorText(page)).toBe(LONG_NOTE.join("\n"));

    await page.keyboard.press("Control+y"); // 浏览器重做打字
    expect(await editorText(page)).toBe(typed);
    await page.keyboard.press("Control+y"); // 轮到拖拽：由我们重放
    expect(await editorText(page)).toBe(moved);
  });

  test("落点插入线画在幽灵行之上：两者压在同一条带时，线仍露在最上面", async ({ page }) => {
    // 幽灵行是**整条通宽 + 实色**，而插入线总落在它那 28px 带里（它画的就是指针所在行的上/下边界）
    // —— 于是"线被挡住"是系统性的，不是偶尔撞上。这条用例盯的就是这个层序（见 design.md「叠层」）。
    await dragLineWith(page, 0, 2, async () => {
      const line = page.locator("[data-insert-line]");
      await expect(line).toBeVisible();
      const lineBox = await line.boundingBox();
      const ghostBox = await page.locator("[data-drag-ghost]").boundingBox();
      if (!lineBox || !ghostBox) throw new Error("取不到插入线或幽灵行");

      // 前提：插入线确实压进了幽灵行那一条带 —— 没有这个前提，下面那条断言就是"白过"
      const top = Math.max(ghostBox.y, lineBox.y);
      const bottom = Math.min(ghostBox.y + ghostBox.height, lineBox.y + lineBox.height);
      expect(bottom - top).toBeGreaterThan(0);

      // 判据：读**真实绘制顺序**。两者都是 `pointer-events:none`，命中测试会跳过它们，所以先临时
      // 打开（只为读序，读完立刻还原），再取重叠带中点看 `elementsFromPoint` 的先后 —— 顺序即画序。
      // 不用"比较 z-index"来替代：线要是被塞回 z-20 那层里、只是自己写着 z-[60]，z 看着更大，画序却是错的。
      const order = await page.evaluate(
        ({ x, y }) => {
          const lineEl = document.querySelector("[data-insert-line]");
          const ghostEl = document.querySelector("[data-drag-ghost]");
          if (!lineEl || !ghostEl) return null;
          for (const el of [lineEl, ghostEl]) (el as HTMLElement).style.pointerEvents = "auto";
          const hits = document.elementsFromPoint(x, y);
          for (const el of [lineEl, ghostEl]) (el as HTMLElement).style.pointerEvents = "";
          return { line: hits.indexOf(lineEl), ghost: hits.indexOf(ghostEl) };
        },
        { x: lineBox.x + lineBox.width / 2, y: (top + bottom) / 2 },
      );

      expect(order).not.toBeNull();
      expect(order?.line).toBeGreaterThanOrEqual(0); // 线画在了这点上
      expect(order?.ghost).toBeGreaterThanOrEqual(0); // 这点上确实还叠着幽灵行（前提成立）
      expect(order?.line).toBeLessThan(order?.ghost ?? -1); // 线在它之上
    });
  });

  test("拖动中不动内容，松手才换位并落盘", async ({ page, app }) => {
    await dragLineWith(page, 0, 2, async () => {
      // 此刻指针已到落点、还没松手。停住 500ms（超过 400ms 落盘防抖）：
      // 若实现是「边拖边改文本 / 边落盘」，这两条断言立刻会抓到。
      await page.waitForTimeout(500);
      expect(await editorText(page)).toBe(LINES.join("\n"));
      expect(readPersistedLines(app.dataDir)).toEqual(LINES);
    });

    expect(await editorText(page)).toBe("第二行\n第三行\n第一行");
    await expectPersistedLines(app.dataDir, ["第二行", "第三行", "第一行"]);
  });
});

/// 按住第一行手柄只往下挪 10px（< 半行 14px）后松手：顺序必须原样不动
async function dragLineWithinHalfRow(page: import("@playwright/test").Page): Promise<void> {
  const handle = await page.getByRole("button", { name: "拖拽调整顺序" }).first().boundingBox();
  if (!handle) throw new Error("取不到第一行的手柄位置");
  const x = handle.x + handle.width / 2;
  const y = handle.y + handle.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + 10, { steps: 4 });
  await page.mouse.up();
}
