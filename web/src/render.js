// JavaScript port of NeonRenderer.renderSVG: byte-identical output (checked against the Solidity
// fixtures by web/test/render.test.mjs). The site draws every Face from the same bytes that live
// on-chain in NeonArt: [grid][10 trait bytes][RLE (color<<5 | len-1)...]
import { keccak256, encodeAbiParameters, hexToBytes } from "viem";

export const TRAITS = ["Crop", "Density", "Neon", "Edge", "Grain", "Light", "Expression", "Accessory", "Block", "Anomaly"];
export const VALUES = [
  ["Eye", "Nose", "Brow", "Cheek", "Temple", "Mouth", "Profile-edge"],
  ["Sparse", "Mid", "Heavy"],
  ["Standard", "Deep", "Hot"],
  ["Stair-step", "Hard cut", "Bleed dither"],
  ["Clean print", "Dusty", "Heavy scan"],
  ["Left", "Right", "Top"],
  ["Flat", "Squint", "Glare", "Wide", "Tense"],
  ["None", "Mole", "Scar", "Stud", "Tape", "Visor"],
  ["Standard", "Fine", "Coarse"],
  ["None", "Dead pixel", "Inverted blocks", "Extra-wide crop", "Double-eye fragment"],
];
export const PALETTES = [
  ["#000000", "#1f2504", "#414d12", "#677920", "#94b21d", "#ccff00", "#f2ffc8", "#ffffff"],
  ["#000000", "#1c2304", "#3c4811", "#5f701e", "#89a61b", "#bcee00", "#f2ffc8", "#ffffff"],
  ["#000000", "#202609", "#454e1b", "#6d7b2d", "#9cb432", "#d6ff1f", "#f2ffc8", "#ffffff"],
];
const BG = 5;

const bytesOf = (rec) => (typeof rec === "string" ? hexToBytes(rec) : rec);

/** Decode a record into grid size, palette, traits and a flat array of palette indices. */
export function decode(rec) {
  const b = bytesOf(rec);
  const g = b[0];
  const cells = new Uint8Array(g * g);
  let p = 0;
  for (let k = 11; k < b.length; k++) {
    const c = b[k] >> 5;
    const n = (b[k] & 31) + 1;
    cells.fill(c, p, p + n);
    p += n;
  }
  const traits = TRAITS.map((t, i) => ({ trait_type: t, value: VALUES[i][b[1 + i]] }));
  return { g, cells, palette: PALETTES[b[3]], traits, grain: b[5] };
}

const rand = (artId, i) => BigInt(keccak256(encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [BigInt(artId), BigInt(i)])));
const dec2 = (v) => `${v / 100n}.${(v % 100n).toString().padStart(2, "0")}`;

/** Exactly the SVG the contract returns for (artId, record). */
export function renderSVG(artId, rec) {
  const b = bytesOf(rec);
  const g = b[0];
  const pal = PALETTES[b[3]];
  const paths = Array.from({ length: 8 }, () => []);
  let pos = 0;
  for (let k = 11; k < b.length; k++) {
    const c = b[k] >> 5;
    let n = (b[k] & 31) + 1;
    while (n > 0) {
      const x = pos % g;
      const seg = Math.min(n, g - x);
      if (c !== BG) paths[c].push(`M${x} ${Math.floor(pos / g)}h${seg}v1h-${seg}z`);
      pos += seg;
      n -= seg;
    }
  }
  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${g} ${g}" width="1200" height="1200" shape-rendering="crispEdges"><rect width="${g}" height="${g}" fill="${pal[BG]}"/>`;
  for (let c = 0; c < 8; c++) if (c !== BG && paths[c].length) s += `<path fill="${pal[c]}" d="${paths[c].join("")}"/>`;

  const grain = b[5];
  const G = BigInt(g);
  if (grain === 1) {
    const dark = [];
    const light = [];
    for (let i = 0; i < 90; i++) {
      const r = rand(artId, i);
      const sz = dec2(8n + ((r >> 64n) % 18n));
      const seg = `M${dec2(r % (G * 100n))} ${dec2((r >> 32n) % (G * 100n))}h${sz}v${sz}h-${sz}z`;
      ((r >> 96n) % 10n < 7n ? dark : light).push(seg);
    }
    s += `<path fill="#000" fill-opacity=".35" d="${dark.join("")}"/><path fill="#fff" fill-opacity=".22" d="${light.join("")}"/>`;
  } else if (grain === 2) {
    const r = rand(artId, 1000);
    s +=
      '<defs><pattern id="s" width="1" height=".5" patternUnits="userSpaceOnUse"><rect width="1" height=".15" fill-opacity=".28"/></pattern>' +
      '<filter id="n" x="0" y="0" width="100%" height="100%">' +
      `<feTurbulence type="fractalNoise" baseFrequency="1.7" numOctaves="2" seed="${artId % 997}"/>` +
      '<feColorMatrix values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 .5 0"/></filter></defs>' +
      `<rect width="${g}" height="${g}" fill="url(#s)"/><rect width="${g}" height="${g}" filter="url(#n)" opacity=".45"/>` +
      `<rect x="${dec2(r % (G * 100n - 100n))}" width="${dec2(20n + ((r >> 32n) % 80n))}" height="${g}" fill="#fff" fill-opacity=".08"/>`;
  }
  return s + "</svg>";
}

export const svgDataURI = (artId, rec) => `data:image/svg+xml;base64,${btoa(renderSVG(artId, rec))}`;

/** Draw a record's blocks onto a canvas (no grain), used by the live mosaic. */
export function drawBlocks(ctx, rec, size) {
  const { g, cells, palette } = decode(rec);
  const s = size / g;
  for (let i = 0; i < cells.length; i++) {
    ctx.fillStyle = palette[cells[i]];
    ctx.fillRect(Math.floor((i % g) * s), Math.floor(Math.floor(i / g) * s), Math.ceil(s), Math.ceil(s));
  }
}
