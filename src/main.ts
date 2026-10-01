import { createApp } from "vue";
import App from "@/app/App.vue";
import "@/style.css";

// 禁用 webview 默认右键菜单：记事本不需要（无边框窗口下它还会盖住自绘 UI）
document.addEventListener("contextmenu", (e) => e.preventDefault());

createApp(App).mount("#app");
