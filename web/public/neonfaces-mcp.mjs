#!/usr/bin/env node
// NEONFACES: talk to your Face. A Model Context Protocol server for AI assistants (Claude Desktop, and any
// MCP client). One file, no dependencies, Node 18+. It only READS the chain; for anything that changes a Face
// it returns a link to the Face page, where the holder reads the action in plain words and confirms it in
// their own wallet. It never sees or asks for keys.
//
// Claude Desktop > Settings > Developer > Edit config, add:
//   "mcpServers": { "neonfaces": { "command": "node", "args": ["C:/path/to/neonfaces-mcp.mjs"] } }
// env (optional): NEONFACES_SITE (default https://neonfaces.xyz/), RPC_URL (default: the site's RPC)
import { createInterface } from "node:readline";

const SITE = (process.env.NEONFACES_SITE || "https://neonfaces.xyz/").replace(/\/?$/, "/");
let dep;
async function deployment() {
  dep ??= await fetch(`${SITE}deployment.json`).then((r) => {
    if (!r.ok) throw new Error(`NEONFACES isn't deployed yet (${SITE}deployment.json not found)`);
    return r.json();
  });
  return dep;
}
const rpcUrl = async () => process.env.RPC_URL || (await deployment()).chain.rpcUrl;

// ---------------------------------------------------------------- minimal JSON-RPC + ABI helpers
let rid = 0;
async function rpc(method, params) {
  const r = await fetch(await rpcUrl(), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++rid, method, params }) }).then((x) => x.json());
  if (r.error) throw new Error(r.error.message);
  return r.result;
}
const word = (v) => BigInt(v).toString(16).padStart(64, "0");
const addr = (a) => a.toLowerCase().replace(/^0x/, "").padStart(64, "0");
const call = (to, data) => rpc("eth_call", [{ to, data }, "latest"]);
const words = (hex) => (hex.slice(2).match(/.{64}/g) || []).map((w) => BigInt("0x" + w));
const asAddr = (w) => "0x" + w.toString(16).padStart(40, "0");
function asString(hex) {
  const b = Buffer.from(hex.slice(2), "hex");
  const off = Number(b.readBigUInt64BE(24));
  const len = Number(b.readBigUInt64BE(off + 24));
  return b.subarray(off + 32, off + 32 + len).toString("utf8");
}
const SEL = {
  tokenURI: "0xc87b56dd", ownerOf: "0x6352211e", balanceOf: "0x70a08231", price: "0xaea91078", agentConfig: "0x5e6b04f3",
  strategyOf: "0x120b1912", leftToday: "0xac26de0c", dailyLimit: "0xf3f51415", lockedUntil: "0x338fc0ad", decimals: "0x313ce567",
  totalSupply: "0x18160ddd", setOf: "0x8ad023eb", isAssembled: "0x214f41ee",
};

const usd = (v8) => `$${(Number(v8) / 1e8).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
const fmt = (v, d) => (Number(v) / 10 ** d).toLocaleString("en-US", { maximumFractionDigits: 6 });
const tokens = async () => (await deployment()).tradeTokens?.map((t) => ({ ...t, symbol: t.symbol === "WETH" ? "ETH" : t.symbol })) ?? [];
const decCache = new Map();
async function decimalsOf(t) {
  if (t.symbol === "ETH") return 18;
  if (!decCache.has(t.address)) decCache.set(t.address, Number(words(await call(t.address, SEL.decimals))[0]));
  return decCache.get(t.address);
}
async function priceOf(t) {
  try {
    return words(await call((await deployment()).trader, SEL.price + addr(t.address)))[0];
  } catch {
    return null; // stale (market closed) or unknown
  }
}

function describeStrategy(ts, w) {
  const [kind, token, funding, bps, every, usd8] = w;
  const sym = (a) => ts.find((t) => t.address.toLowerCase() === asAddr(a).toLowerCase())?.symbol ?? "?";
  const e = Number(every);
  const [n, unit] = e % 604_800 === 0 ? [e / 604_800, "week"] : e % 86_400 === 0 ? [e / 86_400, "day"] : [Math.round(e / 3600), "hour"];
  const per = n === 1 ? `every ${unit}` : `every ${n} ${unit}s`;
  if (kind === 1n) return `accumulate: buy ${sym(token)} with ${usd(usd8)} of ${sym(funding)} ${per}`;
  if (kind === 2n) return `keep at least ${Number(bps) / 100}% in ${sym(token)}, checked ${per}`;
  if (kind === 3n) return `trim ${sym(token)} above ${Number(bps) / 100}% of the Face into ${sym(funding)}, checked ${per}`;
  return "none";
}

// ---------------------------------------------------------------- tools
async function face({ tokenId }) {
  const d = await deployment();
  const id = BigInt(tokenId);
  const owner = asAddr(words(await call(d.faces, SEL.ownerOf + word(id)))[0]);
  const uri = asString(await call(d.faces, SEL.tokenURI + word(id)));
  const meta = JSON.parse(Buffer.from(uri.slice(uri.indexOf(",") + 1), "base64").toString("utf8"));
  const account = meta.account;
  const ts = await tokens();
  const rows = [];
  let total = 0n;
  let stale = false;
  for (const t of ts) {
    const bal = t.symbol === "ETH" ? BigInt(await rpc("eth_getBalance", [account, "latest"])) : words(await call(t.address, SEL.balanceOf + addr(account)))[0];
    if (!bal) continue;
    const dec = await decimalsOf(t);
    const px = await priceOf(t);
    if (px === null) stale = true;
    const v = px === null ? null : (bal * px) / 10n ** BigInt(dec);
    if (v !== null) total += v;
    rows.push(`${fmt(bal, dec)} ${t.symbol}${v === null ? " (price unavailable: market closed)" : ` ≈ ${usd(v)}`}`);
  }
  const [agent, , expiry, active, allowance] = words(await call(account, SEL.agentConfig).catch(() => "0x"));
  const lockedUntil = words(await call(account, SEL.lockedUntil).catch(() => "0x"))[0] ?? 0n;
  const out = [`${meta.name} · holder ${owner} · account ${account}`, `Page: ${SITE}face/${tokenId}`];
  out.push(`Inside: ${rows.length ? rows.join("; ") : "nothing"}${rows.length ? ` · total ≈ ${usd(total)}${stale ? " (some prices unavailable)" : ""}` : ""}`);
  out.push(`Traits: ${meta.attributes.map((a) => `${a.trait_type}: ${a.display_type === "date" ? new Date(a.value * 1000).toISOString().slice(0, 10) : a.value}`).join(" · ")}`);
  if (d.trader) {
    const s = words(await call(d.trader, SEL.strategyOf + addr(account)));
    const [left, cap] = await Promise.all([call(d.trader, SEL.leftToday + addr(account)), call(d.trader, SEL.dailyLimit + addr(account))]).then((r) => r.map((x) => words(x)[0]));
    out.push(`Strategy: ${describeStrategy(ts, s)} · daily trading limit ${usd(cap)}, ${usd(left)} left today`);
  }
  if (active) {
    const isOurs = d.strategyAgent && asAddr(agent).toLowerCase() === d.strategyAgent.toLowerCase();
    out.push(`Agent: ${isOurs ? "the NEONFACES strategy agent" : asAddr(agent)} until ${new Date(Number(expiry) * 1000).toISOString().slice(0, 10)}, ETH budget ${fmt(allowance, 18)}`);
  } else out.push("Agent: none");
  if (lockedUntil * 1000n > BigInt(Date.now())) out.push(`Locked until ${new Date(Number(lockedUntil) * 1000).toISOString().slice(0, 10)}: nothing can leave the account.`);
  const set = words(await call(d.seeder, SEL.setOf + word(id)).catch(() => "0x"));
  if (set[0]) {
    const assembled = words(await call(d.seeder, SEL.isAssembled + word(id)))[0] === 1n;
    out.push(`Set #${set[0]}: this is the ${["left eye", "right eye", "left mouth", "right mouth"][Number(set[1])]}; pieces ${set.slice(2, 6).map((m) => `#${m}`).join(", ")}${assembled ? " · assembled in this Face" : ""}`);
  }
  return out.join("\n");
}

async function prices() {
  const out = [];
  for (const t of await tokens()) {
    const px = await priceOf(t);
    out.push(`${t.symbol}: ${px === null ? "unavailable (market closed or stale)" : usd(px)}`);
  }
  return `Chainlink prices used by NeonTrader (trades refuse prices older than 26 h, so stock trading pauses at weekends):\n${out.join("\n")}`;
}

async function facesOf({ owner }) {
  const d = await deployment();
  if (!d.chain.explorer) return "No explorer configured for this chain.";
  const r = await fetch(`${d.chain.explorer}/api/v2/addresses/${owner}/nft?type=ERC-721`).then((x) => x.json());
  const ids = (r.items ?? []).filter((i) => i.token?.address?.toLowerCase() === d.faces.toLowerCase()).map((i) => `#${i.id}`);
  return ids.length ? `Faces held by ${owner}: ${ids.join(", ")} (first page)` : `No Face found for ${owner}.`;
}

const ACTIONS = ["trade", "withdraw", "lock", "strategy", "stop-agent"];
async function prepare(a) {
  const d = await deployment();
  const ts = (await tokens()).map((t) => t.symbol);
  if (!ACTIONS.includes(a.action)) throw new Error(`action must be one of ${ACTIONS.join(", ")}`);
  const q = new URLSearchParams({ do: a.action });
  const need = (k) => {
    if (a[k] === undefined || a[k] === "") throw new Error(`"${k}" is required for ${a.action}`);
    return String(a[k]);
  };
  const tok = (k) => {
    const v = need(k).toUpperCase();
    if (!ts.includes(v)) throw new Error(`${v} is not tradable. Tradable: ${ts.join(", ")}`);
    return v;
  };
  if (a.action === "trade") (q.set("from", tok("from")), q.set("to", tok("to")), q.set("amount", need("amount")));
  if (a.action === "withdraw") {
    q.set("token", a.token && String(a.token).toLowerCase() !== "all" ? tok("token") : "all");
    if (a.amount) q.set("amount", String(a.amount));
  }
  if (a.action === "lock") q.set("days", need("days"));
  if (a.action === "strategy") {
    if (!d.strategyAgent) throw new Error("The strategy agent isn't published yet.");
    q.set("kind", need("kind"));
    if (a.kind === "accumulate") (q.set("token", tok("token")), q.set("funding", tok("funding")), q.set("usd", need("usd")), q.set("every", a.every || "7d"));
    else q.set("percent", need("percent"));
    if (a.kind === "trim") q.set("token", tok("token"));
    for (const k of ["days", "cap", "eth"]) if (a[k] !== undefined) q.set(k, String(a[k]));
  }
  const link = `${SITE}face/${a.tokenId}?${q}`;
  return `Open this link, connect the wallet that holds Face #${a.tokenId}, read the summary and confirm (nothing happens otherwise):\n${link}\nWithdrawals only go to the holder's own wallet; trades go through NeonTrader (Chainlink-checked, back into the Face); strategies are run by the NEONFACES strategy agent within the daily limit, and can be stopped at any time.`;
}

const TOOLS = [
  { name: "face", description: "Everything about one NEONFACES Face: holder, what its wallet holds (with USD values), traits (tier, set, Gaze, Unblinking), agent, strategy, lock.", inputSchema: { type: "object", properties: { tokenId: { type: "integer", minimum: 1, maximum: 5555 } }, required: ["tokenId"] }, run: face },
  { name: "prices", description: "Current Chainlink prices of the tokens a Face can hold and trade.", inputSchema: { type: "object", properties: {} }, run: prices },
  { name: "faces_of", description: "Which Faces a wallet address holds.", inputSchema: { type: "object", properties: { owner: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" } }, required: ["owner"] }, run: facesOf },
  {
    name: "prepare_action",
    description:
      "Prepare an action on a Face for its holder to confirm on the NEONFACES site (returns a link; nothing is sent). trade: from,to,amount (in `from` units; ETH allowed). withdraw: token (symbol or 'all'), optional amount; always to the holder's own wallet. lock: days (1-365). strategy: kind accumulate (token, funding USDG|ETH, usd per move, every 1d|7d|30d) | keep-liquid (percent in USDG) | trim (token, percent); optional days, cap (USD per day), eth (ETH budget). stop-agent.",
    inputSchema: {
      type: "object",
      properties: {
        tokenId: { type: "integer", minimum: 1, maximum: 5555 },
        action: { type: "string", enum: ACTIONS },
        from: { type: "string" }, to: { type: "string" }, amount: { type: "string" }, token: { type: "string" },
        days: { type: "integer" }, kind: { type: "string", enum: ["accumulate", "keep-liquid", "trim"] }, funding: { type: "string" },
        usd: { type: "number" }, every: { type: "string", enum: ["1d", "7d", "30d"] }, percent: { type: "number" }, cap: { type: "number" }, eth: { type: "string" },
      },
      required: ["tokenId", "action"],
    },
    run: prepare,
  },
];

const INSTRUCTIONS = `NEONFACES are 5555 on-chain pixel faces on Robinhood Chain; every Face is a wallet (ERC-6551) holding Stock Tokens, USDG or ETH.
Use "face" to read a Face before advising. Never promise returns or give investment advice: describe what is inside and what the holder can do.
You cannot move anything: "prepare_action" returns a link the holder opens and confirms in their own wallet. Never ask for keys or seed phrases.
Rules the contracts enforce: trades go through NeonTrader (Chainlink price, at most 1% worse plus pool fee, output back into the Face, daily USD limit, no trades on stale prices at weekends); an agent can only do what the holder allowed, expires, and stops when the Face is sold; a lock blocks everything leaving the wallet.
Stock Tokens give economic exposure only, not legal ownership; whether they are available depends on where the holder lives and on the issuer's terms.`;

// ---------------------------------------------------------------- MCP over stdio (newline-delimited JSON-RPC)
const send = (m) => process.stdout.write(JSON.stringify(m) + "\n");
createInterface({ input: process.stdin }).on("line", async (line) => {
  let m;
  try {
    m = JSON.parse(line);
  } catch {
    return;
  }
  if (m.id === undefined) return; // notifications
  const reply = (result) => send({ jsonrpc: "2.0", id: m.id, result });
  try {
    if (m.method === "initialize") {
      return reply({ protocolVersion: m.params?.protocolVersion ?? "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "neonfaces", version: "1.0.0" }, instructions: INSTRUCTIONS });
    }
    if (m.method === "ping") return reply({});
    if (m.method === "tools/list") return reply({ tools: TOOLS.map(({ run, ...t }) => t) });
    if (m.method === "tools/call") {
      const tool = TOOLS.find((t) => t.name === m.params?.name);
      if (!tool) throw new Error(`unknown tool ${m.params?.name}`);
      try {
        return reply({ content: [{ type: "text", text: await tool.run(m.params.arguments ?? {}) }] });
      } catch (e) {
        return reply({ content: [{ type: "text", text: `Error: ${e.message}` }], isError: true });
      }
    }
    send({ jsonrpc: "2.0", id: m.id, error: { code: -32601, message: `method not found: ${m.method}` } });
  } catch (e) {
    send({ jsonrpc: "2.0", id: m.id, error: { code: -32603, message: e.message } });
  }
});
