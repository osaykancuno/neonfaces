// Ask (/ask, 14 Oct): a chat about NEONFACES answered by an AI with the site's own tools (the Worker's /api/ask,
// web/mcp/ask.mjs). The conversation lives in this tab only (sessionStorage) and is sent with each question; nothing
// is stored on our side. A seed phrase or a private key is stopped here, before anything leaves the browser.
import { looksSecret } from "./guard.js";

const KEY = "nf-ask";
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const load = () => {
  try {
    return JSON.parse(sessionStorage.getItem(KEY) || "[]").filter((m) => m && typeof m.content === "string");
  } catch {
    return [];
  }
};
const store = (msgs) => {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(msgs.slice(-12)));
  } catch {}
};

/** The model's text as safe HTML: escaped, then links (our pages stay in the app), **bold** and "- " lists. */
export function format(text) {
  return esc(text)
    .replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>")
    .replace(/(^|[\s(])((?:https?:\/\/)?(?:www\.)?neonfaces\.xyz(\/[^\s)<,]*)?)/g, (m, pre, url, path) => {
      const p = (path || "/").replace(/[.]+$/, "");
      return `${pre}<a href="${esc(p)}" data-link>neonfaces.xyz${esc(p === "/" ? "" : p)}</a>`;
    })
    .replace(/(^|[\s(])(https:\/\/(?!(?:www\.)?neonfaces\.xyz)[^\s)<]+)/g, (m, pre, url) => `${pre}<a href="${url.replace(/[.,]+$/, "")}" target="_blank" rel="noopener nofollow">${url.replace(/[.,]+$/, "")}</a>`)
    .split("\n")
    .reduce((html, l, i, all) => {
      // list items are blocks of their own; a plain line ends with a break unless a list item or the end follows
      if (/^\s*[-*•]\s+/.test(l)) return html + `<span class="ask-li">${l.replace(/^\s*[-*•]\s+/, "")}</span>`;
      const next = all[i + 1];
      return html + l + (next === undefined || /^\s*[-*•]\s+/.test(next) || (!l.trim() && i > 0) ? "" : "<br>");
    }, "");
}

let busy = false;

export function setupAsk(root) {
  const log = root.querySelector("#ask-log");
  const form = root.querySelector("#ask-form");
  const input = root.querySelector("#ask-input");
  const send = root.querySelector("#ask-send");
  const reset = root.querySelector("#ask-new");
  const q = new URLSearchParams(location.search);
  if (q.get("face") && /^\d{1,4}$/.test(q.get("face"))) input.value = `What does Face #${q.get("face")} see?`;
  else if (q.get("q")) input.value = q.get("q").slice(0, 300);
  if (form.dataset.ready) return paint();
  form.dataset.ready = "1";

  function paint(extra = "") {
    const msgs = load();
    log.innerHTML =
      (msgs.length
        ? msgs.map((m) => `<div class="ask-msg ${m.role === "user" ? "me" : "ai"}">${m.role === "user" ? esc(m.content).replace(/\n/g, "<br>") : format(m.content)}</div>`).join("")
        : `<div class="ask-msg ai">Ask me about any Face, any wallet or any link. I read the chain and answer with facts, never advice.</div>`) + extra;
    reset.hidden = !msgs.length;
    log.scrollTop = log.scrollHeight;
  }
  const note = (text) => paint(`<div class="ask-msg note">${esc(text)}</div>`);

  root.querySelectorAll(".ask-chip").forEach((b) => (b.onclick = () => ((input.value = b.dataset.q), input.focus())));
  reset.onclick = () => {
    store([]);
    paint();
  };
  // the Ask button is type="button": the page never submits natively (a tap before the script runs loses nothing)
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      go();
    }
  });
  send.onclick = () => go();
  form.onsubmit = (e) => (e.preventDefault(), go());
  async function go() {
    const text = input.value.trim();
    if (!text || busy) return;
    if (looksSecret(text)) {
      input.value = "";
      return note("That looks like a seed phrase or a private key: it was not sent. Never type it anywhere. If someone asked you for it, it is a scam, and the wallet should be treated as exposed.");
    }
    const msgs = [...load(), { role: "user", content: text.slice(0, 1500) }];
    store(msgs);
    input.value = "";
    busy = true;
    send.disabled = true;
    paint(`<div class="ask-msg ai wait"><span></span><span></span><span></span> Reading the chain…</div>`);
    try {
      const r = await fetch("/api/ask", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messages: msgs }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.answer) throw new Error(j.error || "The assistant couldn't answer right now: try again in a minute.");
      store([...msgs, { role: "assistant", content: j.answer }]);
      paint();
    } catch (err) {
      store(msgs.slice(0, -1)); // the question can be sent again
      input.value = text;
      note(err.message);
    } finally {
      busy = false;
      send.disabled = false;
    }
  }
  paint();
}
