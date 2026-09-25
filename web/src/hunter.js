// The set hunter: for a set you are building, where the other pieces are, who holds them and for how long, and
// what moved since your last visit. Everything is read from the chain (no backend, no marketplace API): a piece
// that changed hands is a fact the chain records; whether it is listed is for OpenSea to show, one click away.
import { state, read, readAt, short } from "./chain.js";
import { movesSince } from "./journal.js";
import { svgDataURI, PIECES, SINGLES } from "./render.js";

const KEY = "neonfaces.hunter"; // per-viewer convenience: watched sets + the block of the last visit
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const lc = (a) => a.toLowerCase();

function load() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return { watch: Array.isArray(v.watch) ? v.watch.map(Number).filter(Boolean) : [], block: v.block ?? null };
  } catch {
    return { watch: [], block: null };
  }
}
function save(v) {
  try {
    localStorage.setItem(KEY, JSON.stringify(v));
  } catch {}
}

/** One set, seen from `me` (may be null): its four pieces with who controls each and since when. */
async function setState(setId, members, me) {
  const ids = members.map(Number);
  const accounts = await Promise.all(ids.map((m) => read("seeder", "accountOf", [BigInt(m)])));
  const pieces = await Promise.all(
    ids.map(async (id, q) => {
      const [owner, since, holder] = await Promise.all([
        read("faces", "ownerOf", [BigInt(id)]),
        read("faces", "heldSince", [BigInt(id)]),
        readAt(accounts[q], "account", "holder").catch(() => null),
      ]);
      const inPiece = accounts.findIndex((a) => lc(a) === lc(owner));
      let insideFace = null;
      if (inPiece < 0 && (await state.pub.getCode({ address: owner }))) {
        const t = await readAt(owner, "account", "token").catch(() => null);
        if (t && lc(t[1]) === lc(state.dep.faces)) insideFace = Number(t[2]);
      }
      const top = holder ?? owner;
      return {
        id, q, owner, top,
        inside: inPiece >= 0 ? ids[inPiece] : insideFace,
        days: Math.max(0, Math.floor((Date.now() / 1000 - Number(since)) / 86_400)),
        mine: !!me && lc(top) === lc(me),
      };
    }),
  );
  const assembled = await Promise.all(ids.map((m) => read("seeder", "isAssembled", [BigInt(m)])));
  const anchor = ids.find((_, q) => assembled[q]) ?? null;
  return { setId: Number(setId), pieces, anchor };
}

async function records(setId) {
  const sealed = await readAt(state.dep.art, "art", "isSealed").catch(() => false);
  if (!sealed) return null;
  return Promise.all([0, 1, 2, 3].map((q) => readAt(state.dep.art, "art", "artData", [BigInt(SINGLES + 4 * (setId - 1) + q)])));
}

function card(s, recs, watched) {
  const os = state.dep.chain?.opensea;
  const mine = s.pieces.filter((p) => p.mine).length;
  const head = s.anchor
    ? `Complete: assembled in <a href="/face/${s.anchor}" data-link>Face #${s.anchor}</a>`
    : mine
      ? `${mine} of 4 with you · ${4 - mine} to find`
      : "Pieces and holders";
  const row = (p) => {
    const where = p.mine
      ? p.inside ? `yours, inside #${p.inside}` : "yours"
      : p.inside
        ? `inside Face #${p.inside}, held by ${short(p.top)}`
        : `held by ${short(p.top)}`;
    const link = !p.mine && os && !s.anchor ? ` · <a href="${os}/${state.dep.faces}/${p.id}" target="_blank" rel="noopener">see it on OpenSea ↗</a>` : "";
    return `<li class="${p.mine ? "mine" : ""}">${recs ? `<img src="${svgDataURI(SINGLES + 4 * (s.setId - 1) + p.q, recs[p.q])}" alt="">` : ""}
      <span><a href="/face/${p.id}" data-link><b>#${p.id}</b></a> ${esc(PIECES[p.q])}<br>${esc(where)} · ${p.days}d with this holder${link}</span></li>`;
  };
  return `<div class="hunt" data-set="${s.setId}">
    <div class="hunt-head"><b>Set #${s.setId}</b><span>${head}</span>
      <button class="btn btn-ghost hunt-watch" data-set="${s.setId}" aria-pressed="${watched}">${watched ? "Watching" : "Watch"}</button></div>
    <ol class="hunt-pieces">${s.pieces.map(row).join("")}</ol></div>`;
}

/**
 * Render the hunter into `el` for the given Face ids (any piece of each set) and the watched sets.
 * `me` (optional) marks your pieces. Alerts list the pieces of watched sets that changed hands since the last visit.
 */
export async function hunt(el, alertsEl, faceIds, me) {
  const v = load();
  const bySet = new Map();
  let singles = 0;
  let unrevealed = false;
  for (const id of faceIds) {
    const [setId, , members] = await read("seeder", "setOf", [BigInt(id)]);
    if (Number(setId)) bySet.set(Number(setId), members);
    else if (Number(await read("faces", "revealSeed")) === 0) unrevealed = true;
    else singles++;
  }
  // watched sets come back on every visit (their members are remembered with them)
  const watchedIds = v.watch;
  let known = {};
  try {
    known = JSON.parse(localStorage.getItem(`${KEY}.members`) ?? "{}");
  } catch {}
  for (const setId of watchedIds) if (!bySet.has(setId) && known[setId]) bySet.set(setId, known[setId].map(BigInt));

  if (!bySet.size) {
    el.innerHTML = `<p class="fine">${
      unrevealed
        ? "Sets are dealt at the reveal: come back then."
        : singles
          ? "No set piece here: these Faces are single close-ups."
          : me
            ? "No set piece in this wallet yet. Enter any Face # to see its set."
            : "Enter any Face # to see its set, or connect to hunt your own."
    }</p>`;
    alertsEl.innerHTML = "";
    return;
  }

  const states = await Promise.all([...bySet].map(([setId, members]) => setState(setId, members, me)));
  states.sort((a, b) => (a.anchor ? 1 : 0) - (b.anchor ? 1 : 0) || b.pieces.filter((p) => p.mine).length - a.pieces.filter((p) => p.mine).length);
  const recs = await Promise.all(states.map((s) => records(s.setId)));
  el.innerHTML = states.map((s, i) => card(s, recs[i], watchedIds.includes(s.setId))).join("");
  const members = Object.fromEntries(states.map((s) => [s.setId, s.pieces.map((p) => String(p.id))]));
  try {
    localStorage.setItem(`${KEY}.members`, JSON.stringify({ ...known, ...members }));
  } catch {}

  el.querySelectorAll(".hunt-watch").forEach((b) =>
    b.addEventListener("click", () => {
      const cur = load();
      const id = Number(b.dataset.set);
      const on = !cur.watch.includes(id);
      cur.watch = on ? [...cur.watch, id] : cur.watch.filter((x) => x !== id);
      save(cur);
      b.textContent = on ? "Watching" : "Watch";
      b.setAttribute("aria-pressed", String(on));
    }),
  );

  // alerts: pieces of watched sets you don't hold that moved since the last visit
  const latest = await state.pub.getBlockNumber();
  const watchedMissing = states.filter((s) => watchedIds.includes(s.setId)).flatMap((s) => s.pieces.filter((p) => !p.mine).map((p) => ({ ...p, setId: s.setId })));
  let moved = [];
  if (v.block != null && watchedMissing.length) {
    const logs = await movesSince(watchedMissing.map((p) => p.id), BigInt(v.block) + 1n).catch(() => []);
    const ids = new Set(logs.map((l) => Number(l.args.tokenId)));
    moved = watchedMissing.filter((p) => ids.has(p.id));
  }
  alertsEl.innerHTML = moved.length
    ? `<p class="msg">Since your last visit: ${moved
        .map((p) => `<a href="/face/${p.id}" data-link>#${p.id}</a> (${esc(PIECES[p.q])} of set #${p.setId})`)
        .join(", ")} changed hands.</p>`
    : watchedIds.length && v.block != null
      ? `<p class="fine">Nothing moved in your watched sets since your last visit.</p>`
      : "";
  save({ ...load(), block: Number(latest) });
}
