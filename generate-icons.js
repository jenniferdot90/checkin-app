// 运行一次：node generate-icons.js
const zlib = require('zlib');
const fs   = require('fs');
const path = require('path');

const CRC = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC[i] = c;
}
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
  const t = Buffer.from(type, 'ascii');
  const d = Buffer.from(data);
  const l = Buffer.alloc(4); l.writeUInt32BE(d.length);
  const r = Buffer.alloc(4); r.writeUInt32BE(crc32(Buffer.concat([t, d])));
  return Buffer.concat([l, t, d, r]);
}

function makeIcon(size) {
  // 圆角矩形 + 白色对勾
  const rows = [];
  const cx = size / 2 - 0.5, cy = size / 2 - 0.5;
  const hw = size * 0.42, hh = size * 0.42, r = size * 0.22;

  // 对勾三个点（相对坐标，范围 -0.5~0.5）
  const [ax, ay] = [-0.18, 0.04];
  const [bx, by] = [-0.04, 0.19];
  const [cx2, cy2] = [0.20, -0.10];

  function segDist(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1;
    const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(px - x1 - t * dx, py - y1 - t * dy);
  }

  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 4);
    for (let x = 0; x < size; x++) {
      const dx = Math.abs(x - cx) - (hw - r);
      const dy = Math.abs(y - cy) - (hh - r);
      const inside = (Math.max(dx, 0) ** 2 + Math.max(dy, 0) ** 2) <= r * r
                  && Math.max(dx, dy) <= r;
      const i = 1 + x * 4;
      if (inside) {
        // 蓝色背景
        row[i] = 59; row[i+1] = 130; row[i+2] = 246; row[i+3] = 255;
        // 对勾
        const rx = (x - cx) / size, ry = (y - cy) / size;
        const d1 = segDist(rx, ry, ax, ay, bx, by);
        const d2 = segDist(rx, ry, bx, by, cx2, cy2);
        if (Math.min(d1, d2) < 0.048) {
          row[i] = 255; row[i+1] = 255; row[i+2] = 255; row[i+3] = 255;
        }
      } else {
        row[i+3] = 0;
      }
    }
    rows.push(row);
  }

  const raw  = Buffer.concat(rows);
  const idat = zlib.deflateSync(raw, { level: 6 });
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // RGBA

  return Buffer.concat([
    Buffer.from([137,80,78,71,13,10,26,10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

const dir = path.join(__dirname, 'public', 'icons');
fs.mkdirSync(dir, { recursive: true });
for (const s of [192, 512]) {
  const buf = makeIcon(s);
  fs.writeFileSync(path.join(dir, `icon-${s}.png`), buf);
  console.log(`icon-${s}.png  ${buf.length} bytes`);
}
