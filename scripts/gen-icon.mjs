// 极简占位图标生成器：1024×1024 深色圆角方块 + 三行笔记 + 一行被拖起的笔记（红）+ 把手。
// 内容即 dnote 的全称「draggable note」：一个能拖着调上下顺序的记事本。
// 风格与 cdown 的 scripts/gen-icon.mjs 同源（同一套圆角、配色与最小 PNG 编码器）。
// 用法：node scripts/gen-icon.mjs → 生成 app-icon.png，再 pnpm tauri icon app-icon.png。
// 正式图标可直接替换 app-icon.png 后重跑 pnpm tauri icon。
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import path from "node:path";

const S = 1024;
const C = S / 2;
const CORNER = 180;

const BG = [15, 23, 42]; // slate-900：底色，也是窗口背景色
const LINE = [226, 232, 240]; // slate-200：静态的笔记行
const DRAG = [239, 68, 68]; // 红：正在被拖拽的那一行（与 cdown 的强调色一致）

// 圆角矩形（x0..x1 / y0..y1）的有符号距离，用于 1px 抗锯齿
function roundRectSd(x, y, x0, y0, x1, y1, r) {
  const hw = (x1 - x0) / 2;
  const hh = (y1 - y0) / 2;
  const dx = Math.abs(x - (x0 + hw)) - (hw - r);
  const dy = Math.abs(y - (y0 + hh)) - (hh - r);
  return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0) - r;
}

function coverage(sd) {
  return Math.max(0, Math.min(1, 0.5 - sd));
}

// 内容整体竖直居中（内容中心 = 512），左边距 232、行高 56、行高比 40
const LINES = [
  [306, 362, 792], // 行 1：最长
  [402, 458, 648], // 行 2：短
  [498, 554, 716], // 行 3：中
];
// 被拖起的一行：比其它行略粗、整体右移，越出了其它行的右端
const DRAGGED = { x0: 396, y0: 634, x1: 880, y1: 718, r: 42 };
// 把手：红行左侧 2×3 的深色圆点，与界面里行首的「⠿」同一个语汇
const HANDLE = { xs: [444, 474], ys: [652, 676, 700], r: 9 };

const px = Buffer.alloc(S * S * 4, 0);

function blend(i, [r, g, b], a) {
  if (a <= 0) return;
  px[i] = Math.round(px[i] * (1 - a) + r * a);
  px[i + 1] = Math.round(px[i + 1] * (1 - a) + g * a);
  px[i + 2] = Math.round(px[i + 2] * (1 - a) + b * a);
  px[i + 3] = Math.max(px[i + 3], Math.round(a * 255));
}

for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    const i = (y * S + x) * 4;
    // 圆角方块遮罩（带 1px 抗锯齿）
    const dx = Math.max(Math.abs(x - C) - (C - CORNER), 0);
    const dy = Math.max(Math.abs(y - C) - (C - CORNER), 0);
    const mask = Math.max(0, Math.min(1, 0.5 - (Math.hypot(dx, dy) - CORNER)));
    if (mask <= 0) continue;

    blend(i, BG, mask);

    for (const [y0, y1, x1] of LINES) {
      blend(i, LINE, coverage(roundRectSd(x, y, 232, y0, x1, y1, 28)) * mask);
    }

    const d = DRAGGED;
    blend(i, DRAG, coverage(roundRectSd(x, y, d.x0, d.y0, d.x1, d.y1, d.r)) * mask);

    for (const cy of HANDLE.ys) {
      for (const cx of HANDLE.xs) {
        blend(i, BG, coverage(Math.hypot(x - cx, y - cy) - HANDLE.r) * mask);
      }
    }
  }
}

// —— 最小 PNG 编码（RGBA8，filter 0）——
function crc32(buf) {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0);
ihdr.writeUInt32BE(S, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // RGBA

const raw = Buffer.alloc(S * (S * 4 + 1));
for (let y = 0; y < S; y++) {
  raw[y * (S * 4 + 1)] = 0; // filter none
  px.copy(raw, y * (S * 4 + 1) + 1, y * S * 4, (y + 1) * S * 4);
}

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);

const out = path.join(import.meta.dirname, "..", "app-icon.png");
writeFileSync(out, png);
console.log(`已生成 ${out}（${S}×${S}）`);
