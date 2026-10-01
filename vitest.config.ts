import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

// 前端单元测试（`pnpm test:ui`）：跑 `src/**/*.test.ts` 的纯逻辑，环境为 node——
// 被测对象是纯函数（拖拽下标换算），不涉及 DOM 与组件渲染，因此不引 jsdom。
// 独立于 vite.config.ts，但保留 `@` 别名（被测源文件内部以 `@/` 互相导入）。
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
