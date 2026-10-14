// neonfaces.xyz's Worker: the static web app (web/dist) is served as assets without running this code; only /mcp runs it
// (run_worker_first in web.jsonc). /mcp is NEONFACES' remote MCP server (web/mcp/core.mjs, the same as the downloadable
// kit): a holder adds https://neonfaces.xyz/mcp to their AI assistant and asks about their Face, nothing to install.
// MCP "Streamable HTTP", stateless: one POST with a JSON-RPC message (or a batch) gets one JSON reply. Read-only: no keys,
// no sessions, nothing stored about who asks.
// /api/ask is the site's chat ("Ask", web/mcp/ask.mjs): the same tools, answered by a model reached through OpenRouter.
// Its key is the Worker secret OPENROUTER_API_KEY (set by the founder with `wrangler secret put`), never in code or in
// the browser; the models are the var ASK_MODELS (free ones by default, tried in order); ASK_LIMIT limits each visitor.
import { createServer } from "../../web/mcp/core.mjs";
import { answer, validate } from "../../web/mcp/ask.mjs";

const FREE_MODELS = "nvidia/nemotron-3-ultra-550b-a55b:free,nvidia/nemotron-3-super-120b-a12b:free,google/gemma-4-31b-it:free,openrouter/free";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, GET, OPTIONS",
  "access-control-allow-headers": "content-type, accept, mcp-protocol-version, mcp-session-id",
};
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...CORS } });
const ABOUT = `NEONFACES MCP server (read-only)

Add this address to an AI assistant that takes remote MCP servers (custom connectors):
  https://neonfaces.xyz/mcp

Tools: face, analysis (What I see), market, check (a link, an address, a transaction or a signature request), prices,
faces_of, prepare_action (a link the holder confirms on neonfaces.xyz in their own wallet). It never sees keys and never
moves anything. Facts from the chain, not advice. More: https://neonfaces.xyz/llms.txt
`;

let server = null;
const serverFor = (env, url) =>
  (server ??= createServer({
    site: `${url.origin}/`,
    loadDeployment: () => env.ASSETS.fetch(new Request(`${url.origin}/deployment.json`)).then((r) => r.json()),
    // the site's own Alchemy key answers the site's origin; the official node and PublicNode behind it
    rpc: (d) => [...(d.chain.rpcFallbacks ?? []).filter((u) => /alchemy/i.test(u)), d.chain.rpcUrl, ...(d.chain.rpcFallbacks ?? []).filter((u) => !/alchemy|drpc/i.test(u))],
    headers: { origin: "https://neonfaces.xyz" },
  }));

async function ask(request, env, url) {
  const say = (error, status) => json({ error }, status);
  if (request.method !== "POST") return say("POST only.", 405);
  if (!env.OPENROUTER_API_KEY) return say("The assistant isn't switched on yet.", 503);
  const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
  if (env.ASK_LIMIT && !(await env.ASK_LIMIT.limit({ key: ip })).success) return say("Too many questions in a minute: wait a moment and ask again.", 429);
  if (Number(request.headers.get("content-length") ?? 0) > 32_000) return say("That message is too long.", 413);
  let body;
  try {
    body = await request.json();
  } catch {
    return say("That message couldn't be read.", 400);
  }
  const v = validate(body);
  if (v.error) return say(v.error, 400);
  const models = String(env.ASK_MODELS || FREE_MODELS).split(",").map((m) => m.trim()).filter(Boolean);
  // one model at a time, in order: a free model that errors or is busy hands over to the next one; the one that answers
  // keeps the rest of this conversation turn. Logged for `wrangler tail`: model, status, time, OpenRouter's error text
  // (never the question or the answer).
  let start = 0;
  const llm = async (req) => {
    let busy = false;
    let last = "no model answered";
    // two passes: free models are often busy for a moment; after a short pause the list is tried once more
    const order = [...models.slice(start), ...models.slice(start)];
    for (let k = 0; k < order.length; k++) {
      if (k === order.length / 2) await new Promise((ok) => setTimeout(ok, 1500));
      const i = models.indexOf(order[k]);
      const t = Date.now();
      try {
        // ASK_ENDPOINT only for local tests against a scripted model (wrangler dev --env-file); production uses OpenRouter
        const r = await fetch(env.ASK_ENDPOINT || "https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: { authorization: `Bearer ${env.OPENROUTER_API_KEY}`, "content-type": "application/json", "http-referer": "https://neonfaces.xyz", "x-title": "NEONFACES" },
          body: JSON.stringify({ model: models[i], ...req }),
        });
        const j = await r.json().catch(() => null);
        const ok = r.ok && j?.choices?.[0]?.message;
        console.log(JSON.stringify({ ask: models[i], status: r.status, ms: Date.now() - t, ok: !!ok, error: ok ? undefined : String(j?.error?.message ?? j?.choices?.[0]?.error?.message ?? "").slice(0, 200) }));
        if (ok) {
          start = i;
          return j;
        }
        if (r.status === 429) busy = true;
        last = j?.error?.message ?? `answered ${r.status}`;
      } catch (e) {
        last = e.message;
        console.log(JSON.stringify({ ask: models[i], ms: Date.now() - t, ok: false, error: String(e.message).slice(0, 200) }));
      }
    }
    throw Object.assign(new Error(last), { busy });
  };
  try {
    const out = await answer(serverFor(env, url), llm, v.messages);
    return json(out.answer ? out : { error: "No answer this time: ask again in other words." }, out.answer ? 200 : 502);
  } catch (e) {
    return say(e.busy ? "The free assistant is busy right now: try again in a minute." : "The assistant couldn't answer right now: try again in a minute.", e.busy ? 429 : 502);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/ask") return ask(request, env, url);
    if (url.pathname !== "/mcp" && url.pathname !== "/mcp/") return env.ASSETS.fetch(request);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    if (request.method === "GET") {
      // no server-sent stream here; a person who opens the address gets a short note
      if ((request.headers.get("accept") ?? "").includes("text/event-stream")) return new Response("Method Not Allowed", { status: 405, headers: { allow: "POST", ...CORS } });
      return new Response(ABOUT, { headers: { "content-type": "text/plain; charset=utf-8", ...CORS } });
    }
    if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: { allow: "POST, GET, OPTIONS", ...CORS } });
    if (Number(request.headers.get("content-length") ?? 0) > 64_000) return json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Request too large" } }, 413);
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, 400);
    }
    serverFor(env, url);
    const batch = Array.isArray(body);
    const msgs = (batch ? body : [body]).slice(0, 20);
    const replies = (await Promise.all(msgs.map((m) => server.handle(m)))).filter(Boolean);
    if (!replies.length) return new Response(null, { status: 202, headers: CORS }); // notifications only
    return json(batch ? replies : replies[0]);
  },
};
