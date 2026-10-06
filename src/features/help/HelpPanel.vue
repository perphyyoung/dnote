<script setup lang="ts">
/**
 * 帮助面板：标题条上那颗 `?` 打开的内嵌浮层（与设置面板同款，两者互斥、共用一层遮罩）。
 * 内容是**静态只读**的 —— 没有偏好、不落盘、不发 IPC。
 *
 * 键位清单在这里是**第三处**（监听在 `NoteEditor.vue` / `App.vue`，`title` 在各入口按钮上）：
 * 凡列进这份清单的键位，改了必须三处一起改（e2e `14` 拿这份清单当护栏）。`Esc`（收浮层）
 * 属于通用习惯、不必记住，所以不上榜 —— 规则与口径见 design.md「快捷键」节。
 *
 * 文案两条硬约束，都由 e2e `14` 盯着：**书面语**（不口语）、**一条一行不折行**
 * —— 默认窗宽 360 下面板 `w-80`、内容 294px；写不下就**拆成两条**，不缩字号、也不加宽面板。
 */

/// 键位 + 说明。说明列约 196px（≈16 个全角字），超了会折行。
const SHORTCUTS: ReadonlyArray<{ keys: string; what: string }> = [
  { keys: "Ctrl+D", what: "删除光标所在行" },
  { keys: "Alt+↑ / Alt+↓", what: "上下移动光标所在行" },
  { keys: "Alt+S", what: "展开 / 收起次级面板" },
  { keys: "Ctrl+Alt+N", what: "唤起 / 收回窗口" },
];

/// 「与普通笔记应用的区别」：一条一行、一句话说清一件事（约 24 个全角字以内）
const FEATURES: readonly string[] = [
  "无保存按钮，改动即时写入磁盘",
  "拖动行首手柄即可调整顺序",
  "光标所在行高亮，悬停时右侧显示复制与删除",
  "主面板与次级面板独立存储，支持收起次级面板",
  "可调字号、行高比、背景透明度",
  "内置颜色搭配推荐，支持自定义前景和背景颜色",
  "支持置顶、隐藏到托盘与开机自启",
  "拖拽与行编辑均可 Ctrl+Z 撤回",
];
</script>

<template>
  <!-- 贴窗口右缘（与设置面板同一条）：它在标题条下方，且面板够宽 ——
       图钉左侧那颗 `?` 必然落在它的水平范围内，所以看哪都像"从 `?` 下面长出来"。 -->
  <div
    class="absolute top-1 right-2 max-h-[calc(100%-0.5rem)] w-80 max-w-[calc(100%-1rem)] space-y-2 overflow-y-auto rounded-lg border border-slate-700 bg-slate-800 p-3 shadow-xl"
    role="dialog"
    aria-label="帮助"
    @pointerdown.stop
  >
    <p class="text-xs font-medium text-slate-200">快捷键</p>
    <!-- 两列表格：`w-0` + `whitespace-nowrap` 让键位列只占**最宽那条键位**的宽度，
         说明列因此左缘对齐（用 flex 时每行键位宽窄不同，说明会参差）。
         也**不加** `whitespace-nowrap` 到说明列：文案变长时宁可被 e2e 的折行护栏抓住，
         也不要静默横向溢出。 -->
    <table class="w-full border-collapse text-xs">
      <tbody>
        <tr v-for="item in SHORTCUTS" :key="item.keys">
          <th scope="row" class="w-0 py-0.5 pr-3 text-left align-top font-normal whitespace-nowrap">
            <kbd class="rounded bg-slate-900 px-1 font-mono text-[11px] text-slate-200">
              {{ item.keys }}
            </kbd>
          </th>
          <td class="py-0.5 align-top text-slate-400">{{ item.what }}</td>
        </tr>
      </tbody>
    </table>

    <!-- 组间一条分隔线：与设置面板的分组同款，组内不分隔 -->
    <p class="border-t border-slate-700 pt-2 text-xs font-medium text-slate-200">
      与普通笔记应用的区别
    </p>
    <ul class="space-y-1">
      <li v-for="line in FEATURES" :key="line" class="text-xs text-slate-400">{{ line }}</li>
    </ul>
  </div>
</template>
