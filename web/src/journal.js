// The stare journal: what happened to a Face, told from the chain's own events (no backend, no indexer of ours).
// Plus two public boards: the longest stares (Unblinking) and the sets completed so far (first assemblies).
import { parseAbi, parseAbiItem, decodeEventLog, encodeEventTopics, formatUnits } from "viem";
import { state, read, readAt, short } from "./chain.js";
import { describeStrategy } from "./actions.js";

const EV = {
  transfer: parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)"),
  seeded: parseAbiItem("event FaceSeeded(uint256 indexed tokenId, address indexed account, uint32 indexed basketId)"),
  upgraded: parseAbiItem("event FaceUpgraded(uint256 indexed tokenId, address indexed account, uint8 tier, uint32 indexed basketId)"),
  bonus: parseAbiItem("event SetBonusPaidTo(uint256 indexed setId, uint256 indexed anchorId, address indexed account, uint32 basketId)"),
  agentSet: parseAbiItem("event AgentSet(address indexed agent, address indexed grantor, uint64 expiry, uint64 epoch, uint256 valueAllowance)"),
  agentRevoked: parseAbiItem("event AgentRevoked(uint64 epoch)"),
  locked: parseAbiItem("event AccountLocked(uint64 until)"),
  note: parseAbiItem("event Note(address indexed account, string note)"),
  strategy: parseAbiItem("event StrategySet(address indexed account, (uint8 kind, address token, address funding, uint16 bps, uint32 every, uint96 usd8) strategy)"),
  traded: parseAbiItem("event Traded(address indexed account, address indexed tokenIn, address indexed tokenOut, uint256 amountIn, uint256 amountOut, uint256 valueUsd8)"),
};
const TOKEN_ABI = parseAbi(["function token() view returns (uint256 chainId, address tokenContract, uint256 tokenId)"]);
const ZERO = "0x0000000000000000000000000000000000000000";
const TIER = ["", "Glance", "Watch", "Heavy Stare"];

/** Logs of one event, from the node (eth_getLogs) or, if the node refuses the range, from Blockscout's API. */
async function logs(address, event, args = {}) {
  const fromBlock = BigInt(state.dep.deployBlock ?? 0);
  try {
    return await state.pub.getLogs({ address, event, args, fromBlock, toBlock: "latest" });
  } catch {
    const base = state.dep?.chain?.explorer;
    if (!base) return [];
    const topics = encodeEventTopics({ abi: [event], eventName: event.name, args });
    const q = new URLSearchParams({ module: "logs", action: "getLogs", fromBlock: String(fromBlock), toBlock: "latest", address });
    topics.forEach((t, i) => t && q.set(`topic${i}`, t));
    for (let i = 1; i < topics.length; i++) if (topics[i]) q.set(`topic0_${i}_opr`, "and");
    const r = await fetch(`${base}/api?${q}`).then((x) => x.json()).catch(() => null);
    return (r?.result ?? []).map((l) => {
      const d = decodeEventLog({ abi: [event], data: l.data, topics: l.topics.filter(Boolean) });
      return { ...l, args: d.args, blockNumber: BigInt(l.blockNumber), logIndex: Number(l.logIndex), timeStamp: Number(l.timeStamp) };
    });
  }
}

const times = new Map();
async function when(l) {
  if (l.timeStamp) return l.timeStamp;
  if (!times.has(l.blockNumber)) times.set(l.blockNumber, state.pub.getBlock({ blockNumber: l.blockNumber }).then((b) => Number(b.timestamp)));
  return times.get(l.blockNumber);
}

const symbols = new Map();
const sym = (t) => symbols.get(t) ?? symbols.set(t, Promise.all([readAt(t, "erc20", "symbol").catch(() => "?"), readAt(t, "erc20", "decimals").catch(() => 18)])).get(t);
const basketLabel = async (id) => (await Promise.all((await read("seeder", "basket", [id])).map(async (l) => (await sym(l.token))[0]))).join(" / ");

/** "Face #n" when `a` is a Face account, else a short address. */
async function who(a) {
  if (a === ZERO) return "nobody";
  try {
    const [, contract, id] = await state.pub.readContract({ address: a, abi: TOKEN_ABI, functionName: "token" });
    if (contract.toLowerCase() === state.dep.faces.toLowerCase()) return `Face #${id}`;
  } catch {}
  return short(a);
}

/** Journal entries for one Face, newest first: [{ t, text }]. */
export async function journal(id, account) {
  const d = state.dep;
  const idn = BigInt(id);
  const [xfers, seeded, upgraded, bonus, agentSet, agentRevoked, locked, traded, notes, strategies] = await Promise.all([
    logs(d.faces, EV.transfer, { tokenId: idn }),
    logs(d.seeder, EV.seeded, { tokenId: idn }),
    logs(d.seeder, EV.upgraded, { tokenId: idn }),
    logs(d.seeder, EV.bonus, { anchorId: idn }),
    logs(account, EV.agentSet),
    logs(account, EV.agentRevoked),
    logs(account, EV.locked),
    d.trader ? logs(d.trader, EV.traded, { account }) : [],
    d.trader ? logs(d.trader, EV.note, { account }) : [],
    d.trader ? logs(d.trader, EV.strategy, { account }) : [],
  ]);
  const why = new Map(notes.map((l) => [l.transactionHash, l.args.note]));
  const out = [];
  const add = async (l, text) => out.push({ t: await when(l), order: [l.blockNumber, l.logIndex], text });
  for (const l of xfers) {
    const { from, to } = l.args;
    await add(l, from === ZERO ? `Minted to ${await who(to)}. Eyes open.` : `Moved from ${await who(from)} to ${await who(to)}.`);
  }
  for (const l of seeded) await add(l, `Base seed delivered: ${await basketLabel(l.args.basketId)}.`);
  for (const l of upgraded) await add(l, `${TIER[l.args.tier]} top-up delivered: ${await basketLabel(l.args.basketId)}.`);
  for (const l of bonus) await add(l, `Set #${l.args.setId} assembled here for the first time. Set bonus delivered: ${await basketLabel(l.args.basketId)}.`);
  const agentName = (a) => (d.strategyAgent && a.toLowerCase() === d.strategyAgent.toLowerCase() ? "The NEONFACES strategy agent" : `Agent ${short(a)}`);
  for (const l of agentSet) await add(l, `${agentName(l.args.agent)} appointed until ${new Date(Number(l.args.expiry) * 1000).toISOString().slice(0, 10)}.`);
  for (const l of agentRevoked) await add(l, "Agent revoked.");
  for (const l of locked) await add(l, `Locked until ${new Date(Number(l.args.until) * 1000).toISOString().slice(0, 10)}.`);
  for (const l of traded) {
    const [[si, di], [so, dout]] = await Promise.all([sym(l.args.tokenIn), sym(l.args.tokenOut)]);
    const n = (v, dec) => Number(formatUnits(v, dec)).toLocaleString("en-US", { maximumFractionDigits: 6 });
    const note = why.get(l.transactionHash);
    await add(l, `Traded ${n(l.args.amountIn, di)} ${si === "WETH" ? "ETH" : si} for ${n(l.args.amountOut, dout)} ${so === "WETH" ? "ETH" : so} (≈ $${(Number(l.args.valueUsd8) / 1e8).toFixed(2)})${note ? `. Why: "${note}"` : ""}.`);
  }
  for (const l of strategies) await add(l, Number(l.args.strategy.kind) ? `Strategy set: ${describeStrategy(d, l.args.strategy)}` : "Strategy cleared.");
  return out.sort((a, b) => (a.order[0] === b.order[0] ? b.order[1] - a.order[1] : Number(b.order[0] - a.order[0])));
}

/** The longest current stares: [{ id, days, owner }], top n. */
export async function longestStares(n = 10) {
  const supply = Number(await read("faces", "totalSupply"));
  const since = [];
  for (let i = 1; i <= supply; i += 500) {
    const ids = Array.from({ length: Math.min(500, supply - i + 1) }, (_, k) => i + k);
    const r = await Promise.all(ids.map((id) => read("faces", "heldSince", [BigInt(id)])));
    r.forEach((s, k) => since.push({ id: ids[k], since: Number(s) }));
  }
  const top = since.filter((x) => x.since).sort((a, b) => a.since - b.since || a.id - b.id).slice(0, n);
  const now = Date.now() / 1000;
  const owners = await Promise.all(top.map((x) => read("faces", "ownerOf", [BigInt(x.id)])));
  return Promise.all(top.map(async (x, k) => ({ id: x.id, days: Math.floor((now - x.since) / 86400), owner: await who(owners[k]) })));
}

/** Sets assembled for the first time, newest first: [{ setId, anchor, t }]. */
export async function completedSets() {
  const l = await logs(state.dep.seeder, EV.bonus);
  const out = await Promise.all(l.map(async (x) => ({ setId: Number(x.args.setId), anchor: Number(x.args.anchorId), t: await when(x), order: x.blockNumber })));
  return out.sort((a, b) => Number(b.order - a.order));
}

export const fmtDay = (t) => new Date(t * 1000).toISOString().slice(0, 10);
