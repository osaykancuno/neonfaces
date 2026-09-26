// "Is your wallet on the list?": SHA-256 of the lowercase address, first 20 hex digits, looked up in
// /list/<first digit>.txt (16 small files written by tools/allowlist.mjs). Only that slice is downloaded; the
// address itself never leaves the page. The result opens a banner with its clip (/img/list-in.mp4 or list-out.mp4)
// over the blurred site.
import { state } from "./chain.js";
import { sound } from "./effects/sound.js";

const $ = (id) => document.getElementById(id);
const shards = new Map();

function shard(d) {
  if (!shards.has(d)) {
    const p = fetch(`/list/${d}.txt`)
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.text();
      })
      .then((t) => new Set(t.split("\n")))
      .catch((e) => {
        shards.delete(d);
        throw e;
      });
    shards.set(d, p);
  }
  return shards.get(d);
}

async function hash(addr) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(addr));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 20);
}

export function initList() {
  const form = $("al-form");
  if (!form) return;
  const input = $("al-addr"), msg = $("al-msg"), go = $("al-go");
  const banner = $("al-banner"), video = $("al-video");
  const still = matchMedia("(prefers-reduced-motion: reduce)");

  const show = (inList, addr) => {
    banner.classList.toggle("out", !inList);
    $("al-title").textContent = inList ? "You're on the list" : "Not on the list";
    $("al-text").textContent = inList
      ? "This wallet can mint up to 3 Faces in the 24 hours reserved to the list, before the sale opens to everyone."
      : "This wallet isn't on the list. It can mint when the sale opens to everyone, after the 24 hours reserved to the list.";
    $("al-who").textContent = addr;
    const name = inList ? "list-in" : "list-out";
    video.poster = `/img/${name}.png`;
    video.src = `/img/${name}.mp4`;
    banner.hidden = false;
    if (!still.matches) video.play().catch(() => {}); // muted + playsinline: allowed on iPhone and Android
    inList ? sound.success() : sound.error();
    $("al-close").focus();
  };
  const close = () => {
    banner.hidden = true;
    video.pause();
    video.removeAttribute("src");
    video.load();
    input.focus();
  };
  $("al-close").addEventListener("click", close);
  banner.addEventListener("click", (e) => e.target === banner && close());
  addEventListener("keydown", (e) => e.key === "Escape" && !banner.hidden && close());
  // a connected wallet fills the field
  addEventListener("neon:account", () => {
    if (state.account && !input.value) input.value = state.account;
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const addr = input.value.trim();
    if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) {
      msg.textContent = "Paste a wallet address: 0x followed by 40 letters and digits (names like .eth don't work here).";
      return;
    }
    if (!crypto.subtle) {
      msg.textContent = "Your browser can't run the check on this connection. Open the page with https.";
      return;
    }
    msg.textContent = "Checking…";
    go.disabled = true;
    try {
      const h = await hash(addr.toLowerCase());
      const inList = (await shard(h[0])).has(h);
      msg.textContent = "";
      show(inList, addr);
    } catch {
      msg.textContent = "The list couldn't be loaded. Check your connection and try again.";
    } finally {
      go.disabled = false;
    }
  });
}
