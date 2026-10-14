// neonfaces.xyz's Worker: the static web app (web/dist) is served as assets without running this code; only /mcp runs it
// (run_worker_first in web.jsonc). /mcp is NEONFACES' remote MCP server (web/mcp/core.mjs, the same as the downloadable
// kit): a holder adds https://neonfaces.xyz/mcp to their AI assistant and asks about their Face, nothing to install.
// MCP "Streamable HTTP", stateless: one POST with a JSON-RPC message (or a batch) gets one JSON reply. Read-only: no keys,
// no sessions, nothing stored about who asks.
import { createServer } from "../../web/mcp/core.mjs";

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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
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
    server ??= createServer({
      site: `${url.origin}/`,
      loadDeployment: () => env.ASSETS.fetch(new Request(`${url.origin}/deployment.json`)).then((r) => r.json()),
      // the site's own Alchemy key answers the site's origin; the official node and PublicNode behind it
      rpc: (d) => [...(d.chain.rpcFallbacks ?? []).filter((u) => /alchemy/i.test(u)), d.chain.rpcUrl, ...(d.chain.rpcFallbacks ?? []).filter((u) => !/alchemy|drpc/i.test(u))],
      headers: { origin: "https://neonfaces.xyz" },
    });
    const batch = Array.isArray(body);
    const msgs = (batch ? body : [body]).slice(0, 20);
    const replies = (await Promise.all(msgs.map((m) => server.handle(m)))).filter(Boolean);
    if (!replies.length) return new Response(null, { status: 202, headers: CORS }); // notifications only
    return json(batch ? replies : replies[0]);
  },
};
