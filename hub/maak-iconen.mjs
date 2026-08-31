/* Maakt de PWA-iconen zonder externe tools: eigen PNG-encoder op zlib. */
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";

const tabel = (() => { const t = new Int32Array(256);
  for (let n = 0; n < 256; n++){ let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c; } return t; })();
function crc32(buf){ let c = -1; for (const b of buf) c = tabel[(c ^ b) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; }
function chunk(type, data){
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function png(size, pixel){
  const rows = [];
  for (let y = 0; y < size; y++){
    const r = Buffer.alloc(1 + size*4); r[0] = 0;
    for (let x = 0; x < size; x++){
      const [R,G,B,A] = pixel(x, y);
      r[1 + x*4] = R; r[2 + x*4] = G; r[3 + x*4] = B; r[4 + x*4] = A;
    }
    rows.push(r);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.concat(rows), { level: 9 })),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

const ACHTER = [0x0B,0x12,0x20,255];
const GOUD   = [0xF5,0xC5,0x42,255];
/* zelfde vorm als de favicon: voet, kast, antenne */
const VLAKKEN = [[3,11,10,2],[5,6,6,5],[7,3,2,3]];
const inVlak = (x,y) => VLAKKEN.some(([vx,vy,vw,vh]) => x>=vx && x<vx+vw && y>=vy && y<vy+vh);

function teken(size, marge){
  const vak = size - marge*2;
  return (x, y) => {
    const lx = Math.floor((x - marge)/vak*16), ly = Math.floor((y - marge)/vak*16);
    if (lx < 0 || ly < 0 || lx > 15 || ly > 15) return ACHTER;
    return inVlak(lx, ly) ? GOUD : ACHTER;
  };
}

const uit = "/home/user/Agent/hub/public/";
writeFileSync(uit + "icoon-180.png", png(180, teken(180, 14)));
writeFileSync(uit + "icoon-192.png", png(192, teken(192, 16)));
writeFileSync(uit + "icoon-512.png", png(512, teken(512, 42)));
/* maskable: extra rand, want Android snijdt de hoeken eraf */
writeFileSync(uit + "icoon-512-masker.png", png(512, teken(512, 104)));
console.log("iconen geschreven");
