import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { fileURLToPath, URL } from "node:url";
import path from "node:path";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf-8"),
);

const root = fileURLToPath(new URL(".", import.meta.url));

// @ts-expect-error process is env defined by tauri recommended config
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [vue()],
  define: {
    // 版本单一事实源在 package.json（tauri.conf.json 与 Rust 侧 build.rs 同源）
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 白名单：仅监听前端运行所需（index.html + src/ + public/），其余
      //（docs/scripts/src-tauri/dist 等）一律忽略。递归监听项目根会持有
      // 目录句柄，挡住「整目录改名」类操作（paim lessons 第 6 条）。
      ignored: (p) => {
        const rel = path.relative(root, p);
        if (rel === "") return false; // 根目录本身
        return !(
          rel === "index.html" ||
          rel === "src" ||
          rel.startsWith(`src${path.sep}`) ||
          rel === "public" ||
          rel.startsWith(`public${path.sep}`)
        );
      },
    },
  },
});
