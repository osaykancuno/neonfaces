// The preview (landing/, neonfaces.xyz until launch) in the web app's look: the same stylesheet and effects,
// built by `npm run build:preview` into landing/app.js + landing/app.css. The page adds its own views and scripts
// (wallet check, NEONCAM) and imports `sound` from here. No wallet, no chain reads: the preview stays static.
import "./style.css";
import { pixelEye } from "./effects/eye.js";
import { boot, cursor, mosaic, reveals, scramble, tape } from "./effects/fx.js";
import { sound, soundToggle } from "./effects/sound.js";

export { sound };

const $ = (s) => document.querySelector(s);
boot();
cursor();
soundToggle($("#sound-btn"));
tape($("#tape"));
pixelEye($("#eye"));
pixelEye($("#nav-eye"), { cols: 24, rows: 12, fade: false });
fetch("data/gallery.json")
  .then((r) => r.json())
  .then((g) => mosaic($("#mosaic"), (g.faces ?? []).map((f) => f.record)))
  .catch((e) => console.warn("mosaic:", e));
reveals();
document.querySelectorAll(".hero [data-scramble]").forEach((el) => scramble(el, { duration: 1400 }));
