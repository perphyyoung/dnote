import { createApp } from "vue";
import App from "@/app/App.vue";
import "@/style.css";

// 禁用 webview 默认右键菜单：全窗口一律关掉，编辑器里要的那一份是**自绘**的
// （`features/notes/ContextMenu.vue`；无边框窗口下系统菜单还会盖住自绘 UI）。
// 这一层是兜底：任何地方漏了 `preventDefault` 也不会冒出系统菜单。
document.addEventListener("contextmenu", (e) => e.preventDefault());

createApp(App).mount("#app");
