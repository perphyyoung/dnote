// 通用 dev 图标生成器：红底圆角方块 + 白色大写 DEV，产物是**裸 RGBA**（正好是
// `tauri::image::Image::new(rgba, w, h)` 要的格式，无需运行时解码、无需任何 Cargo feature）。
//
// 与项目无关：本文件不引用任何项目代码、不含任何项目配色，零依赖、自包含。
// 复制到任意 Tauri 项目的 scripts/ 下即可用；配套的 Rust 侧样板见 infra/tray.rs（也可整段复制）。
//
// 用法：
//   node scripts/gen-dev-icon.mjs                                   # → src-tauri/icons/tray-dev.rgba
//   node scripts/gen-dev-icon.mjs out.rgba --size=256 --text=DEV --fg=#ffffff --bg=none
//
// 参数：--size=128（托盘实际只按 16–24px 渲染，128 足够）
//       --text=DEV（字形表只画了 D / E / V，需要别的字自己往 GLYPHS 里加一条）
//       --bg=#ef4444（`none` 表示透明底）
//       --fg=#ffffff
//
// 除 .rgba 外还会写两张预览图（同目录同名 .png 与 @16.png，不入库）：@16.png 是按 16px
// 直接渲染出来的，用来预判它在任务栏里糊成什么样。
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const argv = process.argv.slice(2);
const opts = { size: "128", text: "DEV", fg: "#ffffff", bg: "#ef4444" };
const positional = [];
for (const a of argv) {
  const m = /^--([a-z]+)=(.*)$/.exec(a);
  if (m) opts[m[1]] = m[2];
  else positional.push(a);
}
if (!Object.hasOwn(opts, "text")) throw new Error("--text 不能为空");

const outFile = positional[0] ?? path.join("src-tauri", "icons", "tray-dev.rgba");
const size = Number(opts.size);
const text = opts.text;

// —— 几何参数（em：1 = 字号）——
const CAP = 0.72; // 大写字母高度
const STROKE = 0.17; // 笔画粗细（视觉间隙 = GAP - STROKE，务必偏大，否则小尺寸下三字母会粘成一团）
const GAP = 0.22; // 相邻字母中心线之间的额外空隙
const PAD = 0.05; // 图标四周留白（占边长比例）
const CORNER = 0.18; // 底色圆角（占边长比例）

// 字形：w 为字母盒宽度（中心线），parts 有两种图元 ——
//   seg: [x0, y0, x1, y1]（圆头线段）
//   bowl: [cx, cy, rx, ry]（只画右半边的椭圆环，用于 D 的碗；左半被裁掉，正好与竖线相接）
const GLYPHS = {
  // 碗的圆心落在竖线上（cx = 0，rx = w）：左半被裁掉后正好与竖线接成 D
  D: { w: 0.6, parts: [{ seg: [0, 0, 0, CAP] }, { bowl: [0, CAP / 2, 0.6, CAP / 2] }] },
  E: {
    w: 0.52,
    parts: [
      { seg: [0, 0, 0, CAP] },
      { seg: [0, 0, 0.52, 0] },
      { seg: [0, CAP / 2, 0.44, CAP / 2] },
      { seg: [0, CAP, 0.52, CAP] },
    ],
  },
  V: {
    w: 0.6,
    parts: [
      { seg: [0, 0, 0.3, CAP] },
      { seg: [0.3, CAP, 0.6, 0] },
    ],
  },
};

const clamp01 = (v) => Math.max(0, Math.min(1, v));

function parseColor(v) {
  if (!v || v === "none") return null;
  const hex = String(v).replace(/^#/, "");
  if (!/^[0-9a-f]{6}$/i.test(hex)) throw new Error(`颜色要写成 #rrggbb 或 none，收到：${v}`);
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)).concat(255);
}

// 点到线段的距离
function sdSegment(px, py, ax, ay, bx, by) {
  const vx = bx - ax;
  const vy = by - ay;
  const wx = px - ax;
  const wy = py - ay;
  const t = clamp01((wx * vx + wy * vy) / (vx * vx + vy * vy || 1));
  return Math.hypot(wx - vx * t, wy - vy * t);
}

// 椭圆环的（近似）距离：环上为 0，环内为负
function sdBowl(px, py, cx, cy, rx, ry) {
  const q = Math.hypot((px - cx) / rx, (py - cy) / ry);
  return Math.abs(q - 1) * Math.min(rx, ry);
}

// 圆角矩形的有符号距离
function sdRoundRect(px, py, x0, y0, x1, y1, r) {
  const hw = (x1 - x0) / 2;
  const hh = (y1 - y0) / 2;
  const dx = Math.abs(px - (x0 + hw)) - (hw - r);
  const dy = Math.abs(py - (y0 + hh)) - (hh - r);
  return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0) - r;
}

function blend(px, i, [r, g, b], a) {
  if (a <= 0) return;
  px[i] = Math.round(px[i] * (1 - a) + r * a);
  px[i + 1] = Math.round(px[i + 1] * (1 - a) + g * a);
  px[i + 2] = Math.round(px[i + 2] * (1 - a) + b * a);
  px[i + 3] = Math.max(px[i + 3], Math.round(a * 255));
}

/** 渲染一张 S×S 的 RGBA 图：底色圆角方块 + 居中排布的 text */
function render(S, { fg, bg, text }) {
  const glyphs = [...text].map((c) => {
    const g = GLYPHS[c];
    if (!g) throw new Error(`字形表里没有 "${c}"（只画了 ${Object.keys(GLYPHS).join(" / ")}）`);
    return g;
  });

  // 按「铺满可用宽度」反推字号：letters 的中心线总宽 = 各字母宽 + 字母间空隙
  const centerWidth = glyphs.reduce((s, g) => s + g.w, 0) + GAP * (glyphs.length - 1);
  const em = ((1 - 2 * PAD) * S) / (centerWidth + STROKE);
  const stroke = STROKE * em;
  const top = (S - CAP * em) / 2;

  // 展开成像素空间的图元
  const parts = [];
  let x = (S - (centerWidth + STROKE) * em) / 2 + stroke / 2;
  for (const g of glyphs) {
    for (const p of g.parts) {
      if (p.seg) {
        parts.push({
          kind: "seg",
          ax: x + p.seg[0] * em,
          ay: top + p.seg[1] * em,
          bx: x + p.seg[2] * em,
          by: top + p.seg[3] * em,
        });
      } else {
        parts.push({
          kind: "bowl",
          cx: x + p.bowl[0] * em,
          cy: top + p.bowl[1] * em,
          rx: p.bowl[2] * em,
          ry: p.bowl[3] * em,
        });
      }
    }
    x += (g.w + GAP) * em;
  }

  const px = Buffer.alloc(S * S * 4, 0);
  for (let y = 0; y < S; y++) {
    for (let xx = 0; xx < S; xx++) {
      const i = (y * S + xx) * 4;
      const cx = xx + 0.5;
      const cy = y + 0.5;

      // 底色：整块圆角方块（1px 抗锯齿）
      const mask = bg ? clamp01(0.5 - sdRoundRect(cx, cy, 0, 0, S, S, CORNER * S)) : 1;
      if (mask <= 0) continue;
      if (bg) blend(px, i, bg, mask);

      // 文字：所有图元取并集，再被底色裁剪，避免超出圆角
      let d = Infinity;
      for (const p of parts) {
        const dd =
          p.kind === "seg"
            ? sdSegment(cx, cy, p.ax, p.ay, p.bx, p.by)
            : cx >= p.cx
              ? sdBowl(cx, cy, p.cx, p.cy, p.rx, p.ry)
              : Infinity;
        if (dd < d) d = dd;
      }
      blend(px, i, fg, clamp01(0.5 - (d - stroke / 2)) * mask);
    }
  }
  return px;
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

function toPng(px, S) {
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
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// —— 主流程 ——
if (!Number.isInteger(size) || size < 8 || size > 4096) throw new Error(`--size 不合法：${opts.size}`);
const fg = parseColor(opts.fg) ?? [255, 255, 255];
const bg = parseColor(opts.bg);
const base = outFile.replace(/\.[^.]+$/, "");

mkdirSync(path.dirname(path.resolve(outFile)), { recursive: true });
writeFileSync(outFile, render(size, { fg, bg, text })); // 裸 RGBA：给 tauri::image::Image::new
writeFileSync(`${base}.png`, toPng(render(size, { fg, bg, text }), size));
writeFileSync(`${base}@16.png`, toPng(render(16, { fg, bg, text }), 16));

console.log(`已生成 ${outFile}（${size}×${size} 裸 RGBA，text="${text}"）`);
console.log(`预览：${base}.png、${base}@16.png（后者是按 16px 渲染的，拿来预判任务栏里的效果）`);
