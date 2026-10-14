// What I see, the scam guard (docs/ANALYST.md): a link, an address, a transaction or a signature request, told in plain
// words before the holder clicks or signs. Pure functions, no imports, no network: the page adds what only the chain
// can say (is it a contract, what does it call itself). Everything runs in the browser; nothing pasted leaves it.
// A clean check is not a guarantee: every answer says so.

export const OFFICIAL_SITE = "neonfaces.xyz";
const OFFICIAL_X = "osaykancuno";
const OFFICIAL_COLLECTION = "neonfaces"; // opensea.io/collection/neonfaces
const UNLIMITED = 2n ** 255n;

/** Well-known contracts that are not ours but that the official flows use. */
const WELL_KNOWN = {
  "0x1e0049783f008a0085193e00003d00cd54003c71": "OpenSea's conduit (it moves NFTs for OpenSea listings)",
  "0x0000000000000068f116a894984e2db1123eb395": "OpenSea's Seaport 1.6 (the marketplace contract)",
  "0x000000000022d473030f116ddee9f6b43ac78ba3": "Uniswap's Permit2",
};

/** Addresses the guard recognises, from deployment.json: [{ address (lowercase), name, ours, kind }]. */
export function knownFrom(dep) {
  const k = [];
  const add = (a, name, kind = "contract", ours = true) => a && k.push({ address: a.toLowerCase(), name, kind, ours });
  add(dep.faces, "NEONFACES, the collection", "collection");
  add(dep.seeder, "NeonSeeder (Face accounts, baskets and sets)");
  add(dep.trader, "NeonTrader (trades inside a Face at Chainlink prices)", "trader");
  add(dep.seaDrop, "OpenSea's SeaDrop, where NEONFACES are minted", "seadrop", false);
  add(dep.seedVault, "NeonSeedVault (the basket pool)");
  add(dep.payout, "NeonPayout (the mint's split)");
  add(dep.registry, "the ERC-6551 registry (Face accounts)", "contract", false);
  add(dep.accountImplementation, "the Face account code");
  add(dep.art, "NeonArt (the on-chain art)");
  add(dep.renderer, "the NEONFACES renderer");
  add(dep.teamVesting, "the team's vesting contract");
  add(dep.setVotes, "NeonSetVotes (the sets' polls)");
  add(dep.strategyAgent, "the NEONFACES strategy agent", "agent");
  for (const t of dep.tradeTokens ?? []) add(t.address, `the listed ${t.symbol === "WETH" ? "WETH" : t.symbol} token`, "token", false);
  for (const [a, name] of Object.entries(WELL_KNOWN)) k.push({ address: a, name, kind: "service", ours: false });
  return k;
}
const lookup = (known, a) => known.find((x) => x.address === String(a).toLowerCase());
const tokenSymbols = (known) => new Map(known.filter((x) => x.kind === "token").map((x) => [x.name.replace("the listed ", "").replace(" token", "").toUpperCase(), x.address]));

const short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const name = (known, a) => lookup(known, a)?.name ?? short(a);
const CLEAN_NOTE = "A clean check is not a guarantee: a new scam can look clean.";
const TRICKS = "Nobody from NEONFACES DMs first. There is no airdrop, no claim and no stealth mint. Never share your seed phrase.";

// ---------------------------------------------------------------- links

const SKELETON = [[/0/g, "o"], [/1|!|\|/g, "l"], [/3/g, "e"], [/5|\$/g, "s"], [/rn/g, "m"], [/vv/g, "w"], [/[-_.]/g, ""]];
const skeleton = (s) => SKELETON.reduce((x, [r, b]) => x.replace(r, b), s.toLowerCase());
function distance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
/** True when a name imitates "neonfaces": contains it after undoing swapped letters, or is one or two letters away. */
export function imitates(s, target = "neonfaces") {
  const k = skeleton(s);
  if (!k) return false;
  if (k.includes(target.slice(0, -1))) return true; // neonface, neonfaces-mint, neon-faces…
  return k.length >= 6 && distance(k, target) <= 2;
}
const BAIT = /claim|airdrop|free-?mint|stealth|reward|giveaway|bonus|verify|validate|sync|restore|migrat|revoke-?all|wallet-?connect|rectify|unlock/i;

/** → { level: "ok" | "info" | "warn" | "danger", title, lines } */
export function checkLink(input, known = []) {
  if (/^(javascript|data|vbscript|file|blob):/i.test(input.trim()))
    return { level: "danger", title: "Not a web link", lines: [`It starts with "${input.trim().split(":")[0]}:". Links like this can run code on the page: don't open it.`, TRICKS] };
  let url;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(input) ? input : `https://${input}`);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const path = decodeURIComponent(url.pathname + url.search).toLowerCase();
  const lines = [];
  const bait = BAIT.test(path) || BAIT.test(host);
  if (url.protocol !== "https:" && url.protocol !== "http:") return { level: "danger", title: "Not a web link", lines: [`It starts with "${url.protocol}". Links like this can run code or open apps: don't open it.`, TRICKS] };
  if (host.startsWith("xn--") || host.includes(".xn--") || /[^\x00-\x7f]/.test(url.hostname))
    return { level: "danger", title: "Lookalike letters", lines: [`The address "${host}" is written with letters from another alphabet that look like ours. It is not neonfaces.xyz: don't connect a wallet or sign anything there.`, TRICKS] };

  if (host === OFFICIAL_SITE) {
    lines.push("This is neonfaces.xyz, the official site.");
    if (url.protocol !== "https:") lines.push("Open it with https:// to be sure nothing sits in between.");
    if (/[?&]do=/.test(url.search)) lines.push("It prepares an action on a Face: the page shows it in plain words and nothing happens until the holder confirms in their own wallet.");
    return { level: "ok", title: "Official", lines: [...lines, CLEAN_NOTE] };
  }
  if (host.endsWith(`.${OFFICIAL_SITE}`)) return { level: "warn", title: "Not one of our addresses", lines: [`${host} is not an address we use. The site is only neonfaces.xyz.`, TRICKS] };

  if (host === "x.com" || host === "twitter.com") {
    const user = url.pathname.split("/")[1]?.toLowerCase() ?? "";
    if (user === OFFICIAL_X) return { level: "ok", title: "Official account", lines: ["x.com/osaykancuno is the official NEONFACES account.", CLEAN_NOTE] };
    if (imitates(user) || imitates(user, OFFICIAL_X)) return { level: "danger", title: "Impostor account", lines: [`@${user} imitates us. Our only account is x.com/osaykancuno.`, TRICKS] };
    return { level: "info", title: "Not our account", lines: [`@${user || "?"} is not the NEONFACES account (x.com/osaykancuno).`, CLEAN_NOTE] };
  }

  if (host === "opensea.io") {
    const col = path.match(/\/collection\/([^/?#]+)/)?.[1];
    if (col === OFFICIAL_COLLECTION) return { level: "ok", title: "The official collection", lines: ["opensea.io/collection/neonfaces is the official NEONFACES collection.", CLEAN_NOTE] };
    if (col) return { level: imitates(col) ? "danger" : "info", title: imitates(col) ? "Fake collection" : "Another collection", lines: [`"${col}" is not the NEONFACES collection. Ours is opensea.io/collection/neonfaces, contract ${known.find((k) => k.kind === "collection")?.address ?? "0x67384d95…1C1B"}.`, imitates(col) ? TRICKS : CLEAN_NOTE] };
    const contract = path.match(/0x[0-9a-f]{40}/)?.[0];
    if (contract) {
      const k = lookup(known, contract);
      if (k?.kind === "collection") return { level: "ok", title: "A real NEONFACES", lines: [`The contract in the link is the NEONFACES collection.`, CLEAN_NOTE] };
      return { level: "warn", title: "Not a NEONFACES", lines: [`The contract in this link, ${short(contract)}, is not the NEONFACES collection, whatever the page calls it.`, TRICKS] };
    }
    return { level: "info", title: "OpenSea", lines: ["opensea.io is the marketplace where NEONFACES trade. Check that a Face's contract is 0x67384d95…1C1B before you act on it.", CLEAN_NOTE] };
  }

  if (host === "robinhoodchain.blockscout.com") return { level: "info", title: "The block explorer", lines: ["Robinhood Chain's block explorer (not ours). Reading there is safe; connect a wallet only to call a contract you checked here first.", CLEAN_NOTE] };

  const label = host.split(".").slice(0, -1).join(".");
  if (imitates(label) || imitates(host.replace(/\./g, "")))
    return { level: "danger", title: "Imitation of neonfaces.xyz", lines: [`${host} is not neonfaces.xyz: it imitates our name. Don't connect a wallet, sign or type anything there.`, TRICKS] };
  if (bait) lines.push("The link talks about claims, airdrops, rewards or wallet fixes: the usual bait of wallet drainers.");
  return {
    level: bait ? "danger" : "info",
    title: bait ? "Bait" : "Not ours",
    lines: [`${host} is not on our official list (neonfaces.xyz, opensea.io/collection/neonfaces, x.com/osaykancuno).`, ...lines, "To mint or manage a Face, nothing else is needed.", bait ? TRICKS : CLEAN_NOTE],
  };
}

// ---------------------------------------------------------------- addresses

/** What an address is, from the known list alone. The page adds getCode, name() and symbol() through extra(). */
export function checkAddress(a, known = []) {
  const k = lookup(known, a);
  if (k) return { level: "ok", title: k.ours ? "Official NEONFACES" : "Known", lines: [`${a} is ${k.name}.`, CLEAN_NOTE] };
  const lo = a.toLowerCase();
  const twin = known.find((x) => x.address.slice(2, 6) === lo.slice(2, 6) && x.address.slice(-4) === lo.slice(-4));
  if (twin)
    return {
      level: "danger",
      title: "Lookalike address",
      lines: [`It starts and ends like ${twin.name} (${twin.address}) but it is a different address. Scammers create lookalikes and slip them into your history so you copy the wrong one. Don't send anything to it.`],
    };
  return { level: "info", title: "Unknown address", lines: [`${short(a)} is not one of the addresses NEONFACES uses.`, CLEAN_NOTE] };
}

/** Facts read from the chain about an unknown address: { code: bool, name, symbol } → extra lines and a level. */
export function addressFacts(facts, known = []) {
  const lines = [];
  let level = "info";
  if (!facts.code) lines.push("It is a wallet (no contract code).");
  else {
    lines.push(`It is a contract${facts.name ? ` called "${facts.name}"${facts.symbol ? ` (${facts.symbol})` : ""}` : ""}.`);
    if (facts.name && (imitates(facts.name) || imitates(facts.symbol ?? ""))) {
      level = "danger";
      lines.push("It calls itself NEONFACES but it is not our contract (0x67384d95…1C1B): a fake collection or a fake token.");
    }
    const real = facts.symbol && tokenSymbols(known).get(facts.symbol.toUpperCase());
    if (real) {
      level = "danger";
      lines.push(`It uses the ticker ${facts.symbol}, but the listed ${facts.symbol} is ${real}. A lookalike token: don't trade it or open any link it shows.`);
    }
    if (/https?:|www\.|\.com|\.xyz|claim|visit|reward/i.test(`${facts.name} ${facts.symbol}`)) {
      level = "danger";
      lines.push("Its name carries a link or a claim: bait sent to wallets. Never open the link or interact with it.");
    }
  }
  return { level, lines };
}

// ---------------------------------------------------------------- transactions and signatures

const words = (hex) => (hex.match(/.{64}/g) ?? []).map((w) => BigInt(`0x${w}`));
const asAddr = (w) => `0x${w.toString(16).padStart(40, "0")}`;
const amountText = (v, unit = "") => (v >= UNLIMITED ? `any amount${unit ? ` of ${unit}` : ""}` : `${v.toString()} base units${unit ? ` of ${unit}` : ""}`);
const ETH = (wei) => `${(Number(wei) / 1e18).toLocaleString("en-US", { maximumFractionDigits: 6 })} ETH`;

/** Plain words for a call: data (0x…) sent to `to` with `value` wei, from the holder's wallet or a Face account. */
export function decodeCall({ to, data = "0x", value = 0n }, known = [], depth = 0) {
  const lines = [];
  let level = "info";
  const raise = (l) => (level = { info: 0, ok: 0, warn: 1, danger: 2 }[l] > { info: 0, ok: 0, warn: 1, danger: 2 }[level] ? l : level);
  const target = to ? lookup(known, to) : null;
  const tName = to ? name(known, to) : "an unknown contract";
  const hex = String(data).toLowerCase().replace(/^0x/, "");
  value = BigInt(value || 0);
  if (!hex) {
    if (value > 0n) lines.push(`It sends ${ETH(value)} to ${tName}. Once sent, nobody can bring it back.`);
    else lines.push("It calls nothing and sends nothing.");
    return { level, lines };
  }
  const sel = hex.slice(0, 8);
  const w = words(hex.slice(8));
  const spenderOk = (a) => {
    const k = lookup(known, a);
    return k && (k.kind === "trader" || k.kind === "service");
  };
  switch (sel) {
    case "095ea7b3":
    case "39509351": {
      const spender = asAddr(w[0]);
      lines.push(`It lets ${name(known, spender)} take ${amountText(w[1], target?.name.replace("the listed ", "") ?? `the token at ${short(to ?? "0x")}`)} from this wallet, whenever it wants, until you revoke it.`);
      if (w[1] === 0n) lines.length = 0, lines.push(`It sets the allowance of ${name(known, spender)} to zero: a revoke. Safe.`);
      else if (!spenderOk(spender)) {
        raise(w[1] >= UNLIMITED ? "danger" : "warn");
        lines.push("The spender is not NeonTrader or a known service. This is how most wallets are emptied: don't sign it unless you know exactly who that is.");
      }
      break;
    }
    case "a22cb465": {
      const op = asAddr(w[0]);
      const on = w[1] !== 0n;
      const what = target?.kind === "collection" ? "every NEONFACES in this wallet, with everything inside them" : `every NFT this wallet owns in the collection ${tName}`;
      if (!on) lines.push(`It removes ${name(known, op)}'s permission over ${what}. Safe.`);
      else {
        lines.push(`It lets ${name(known, op)} move ${what}, now and later, without asking again.`);
        if (lookup(known, op)?.kind === "service") lines.push("That is OpenSea's own contract: listing on OpenSea asks for this once per collection.");
        else (raise("danger"), lines.push("The operator is not a marketplace we know. This single signature is enough to take all of them: don't sign it."));
      }
      break;
    }
    case "a9059cbb":
      lines.push(`It sends ${amountText(w[1], target?.name.replace("the listed ", "") ?? "a token")} to ${name(known, asAddr(w[0]))}. Once sent, nobody can bring it back.`);
      raise("warn");
      break;
    case "23b872dd":
    case "42842e0e":
    case "b88d4fde": {
      const nft = target?.kind === "collection";
      lines.push(`It moves ${nft ? `NEONFACES #${w[2]}` : `item or amount ${w[2]}`} from ${name(known, asAddr(w[0]))} to ${name(known, asAddr(w[1]))}.${nft ? " The Face takes everything inside it along." : ""} Once sent, nobody can bring it back.`);
      raise("warn");
      break;
    }
    case "161ac21f": {
      const nft = asAddr(w[0]);
      if (target?.kind === "seadrop" && lookup(known, nft)?.kind === "collection") {
        lines.push(`It mints ${w[3]} NEONFACES through OpenSea's SeaDrop, paying ${ETH(value)}: the official mint.`);
        level = "ok";
      } else {
        lines.push(`It mints from ${name(known, nft)}${target ? "" : ` through ${tName}`}: not the NEONFACES collection.`);
        raise("danger");
      }
      break;
    }
    case "98e9bbb6":
      lines.push(target?.kind === "trader" ? "A trade inside a Face through NeonTrader: the output always comes back into the Face, at most 2% from Chainlink." : `A call named like NeonTrader's trade, sent to ${tName}, which is not NeonTrader.`);
      if (target?.kind !== "trader") raise("danger");
      break;
    case "5c946896":
      lines.push(`It locks the Face account until ${new Date(Number(w[0]) * 1000).toISOString().slice(0, 10)}: nothing can leave it before then, not even for the holder.`);
      break;
    case "171908d5":
      lines.push(`It appoints ${name(known, asAddr(w[0]))} as the Face's agent until ${new Date(Number(w[1]) * 1000).toISOString().slice(0, 10)}, with an ETH budget of ${ETH(w[3])}. It can call only the actions you ticked; read them on the Face page before signing.`);
      if (lookup(known, asAddr(w[0]))?.kind !== "agent") (raise("warn"), lines.push("That agent is not the NEONFACES strategy agent."));
      break;
    case "87517c45":
      lines.push(`It lets ${name(known, asAddr(w[1]))} spend ${w[2] >= 2n ** 159n ? "any amount" : `${w[2]} base units`} of ${name(known, asAddr(w[0]))} through Permit2, until ${new Date(Number(w[3]) * 1000).toISOString().slice(0, 10)}.`);
      if (!spenderOk(asAddr(w[1]))) raise("danger");
      break;
    case "51945447":
    case "a7425cdb": {
      lines.push("A Face account runs what follows:");
      if (depth > 1) break;
      const inner = [];
      if (sel === "51945447") {
        const off = Number(w[2]) * 2;
        const len = Number(BigInt(`0x${hex.slice(8 + off, 8 + off + 64)}`)) * 2;
        inner.push({ to: asAddr(w[0]), value: w[1], data: `0x${hex.slice(8 + off + 64, 8 + off + 64 + len)}` });
      } else {
        const body = hex.slice(8);
        const at = (o) => BigInt(`0x${body.slice(o * 2, o * 2 + 64)}`);
        const arr = Number(at(0)) * 2;
        const n = Number(at(arr / 2));
        for (let i = 0; i < Math.min(n, 12); i++) {
          const el = arr + 64 + Number(at(arr / 2 + 32 + i * 32)) * 2;
          const t = asAddr(at(el / 2));
          const v = at(el / 2 + 32);
          const doff = el + Number(at(el / 2 + 64)) * 2;
          const dlen = Number(at(doff / 2)) * 2;
          inner.push({ to: t, value: v, data: `0x${body.slice(doff + 64, doff + 64 + dlen)}` });
        }
      }
      for (const c of inner) {
        const r = decodeCall(c, known, depth + 1);
        raise(r.level);
        lines.push(...r.lines.map((l) => `· ${l}`));
      }
      break;
    }
    default:
      lines.push(`A call to ${tName} that this check can't read (function ${`0x${sel}`}). Don't sign what nobody can tell you in plain words.`);
      raise(target?.ours ? "info" : "warn");
  }
  if (value > 0n && sel !== "161ac21f") lines.push(`It also sends ${ETH(value)}.`);
  return { level, lines };
}

/** Plain words for an EIP-712 signature request (eth_signTypedData_v4). */
export function decodeTypedData(td, known = []) {
  const m = td.message ?? {};
  const pt = td.primaryType;
  const vc = td.domain?.verifyingContract;
  const lines = [];
  let level = "warn";
  const until = (s) => (s ? ` until ${new Date(Number(s) * 1000).toISOString().slice(0, 10)}` : "");
  const big = (v) => (BigInt(v ?? 0) >= 2n ** 159n ? "any amount" : `${BigInt(v ?? 0)} base units`);
  const free = (a) => lookup(known, a)?.kind === "trader" || lookup(known, a)?.kind === "service";
  if (pt === "Permit") {
    lines.push(`A signature, not a transaction, but it does the same as an approval: it lets ${name(known, m.spender)} take ${big(m.value)} of ${name(known, vc ?? "0x")} from your wallet${until(m.deadline)}, with no other confirmation.`);
    level = free(m.spender) ? "warn" : "danger";
  } else if (pt === "PermitSingle" || pt === "PermitBatch") {
    const d = [m.details ?? []].flat();
    lines.push(`A Permit2 signature: it lets ${name(known, m.spender)} spend ${d.map((x) => `${big(x.amount)} of ${name(known, x.token)}`).join(", ")}${until(m.sigDeadline)}.`);
    level = free(m.spender) ? "warn" : "danger";
  } else if (/^Permit(Witness)?(Batch)?TransferFrom$/.test(pt)) {
    const p = [m.permitted ?? []].flat();
    lines.push(`A Permit2 signature that lets ${name(known, m.spender)} move ${p.map((x) => `${big(x.amount)} of ${name(known, x.token)}`).join(", ")} out of your wallet right away.`);
    level = "danger";
  } else if (pt === "OrderComponents") {
    const items = (xs) => xs.map((x) => (["0", "1"].includes(String(x.itemType)) ? `${String(x.itemType) === "0" ? ETH(BigInt(x.startAmount)) : `${BigInt(x.startAmount)} base units of ${name(known, x.token)}`}` : `${[4, 5].includes(Number(x.itemType)) ? "ANY item" : `item #${x.identifierOrCriteria}`} of ${name(known, x.token)}`));
    const give = items(m.offer ?? []);
    const get = (m.consideration ?? []).filter((c) => String(c.recipient).toLowerCase() === String(m.offerer).toLowerCase());
    const getText = items(get);
    lines.push(`An OpenSea (Seaport) order: you give ${give.join(", ") || "nothing"} and receive ${getText.join(", ") || "NOTHING"}${until(m.endTime)}.`);
    const nftOut = (m.offer ?? []).some((x) => Number(x.itemType) >= 2);
    const paid = get.reduce((s, c) => s + (["0", "1"].includes(String(c.itemType)) ? BigInt(c.startAmount) : 0n), 0n);
    if (nftOut && paid < 10n ** 15n) {
      level = "danger";
      lines.push("Listing NFTs for almost nothing is the most common way to lose them: someone fills the order at once. Don't sign it.");
    } else lines.push("Check every item and the price above before signing.");
    if ((m.offer ?? []).some((x) => [4, 5].includes(Number(x.itemType)))) (level = "danger"), lines.push("\"ANY item\" means any NFT of that collection in your wallet.");
  } else {
    lines.push(`A signature of type "${pt ?? "?"}" for ${vc ? name(known, vc) : "an app"}. This check can't read it in full: sign only if you trust the site that asks and understand what it grants.`);
  }
  return { level, lines };
}

const SEED = /^([a-z]+\s+){11}([a-z]+\s+){0,12}[a-z]+$/;

/** Text that carries a secret nobody should type anywhere, so the site's chat refuses to send it:
 *  - a seed phrase: a line made only of 12 to 24 lowercase words, or such a run of words next to "seed", "phrase",
 *    "mnemonic", "recovery" or "secret";
 *  - a private key: 64 hex digits that the text doesn't present as a transaction or block hash.
 *  → "seed" | "key" | null */
export function looksSecret(text) {
  const t = String(text ?? "");
  const lines = t.split(/\r?\n/).map((l) => l.trim().toLowerCase());
  const onlyWords = (s) => {
    const w = s.split(/\s+/);
    return w.length >= 12 && w.length <= 24 && w.every((x) => /^[a-z]{3,8}$/.test(x));
  };
  if (lines.some(onlyWords)) return "seed";
  if (/\b(seed|phrase|mnemonic|recovery|secret)\b/i.test(t)) {
    let run = 0;
    for (const w of t.toLowerCase().split(/\s+/)) {
      run = /^[a-z]{3,8}[.,;:]?$/.test(w) ? run + 1 : 0;
      if (run >= 12) return "seed";
    }
  }
  const hex = /(?:^|[^0-9a-z])(?:0x)?[0-9a-f]{64}(?![0-9a-z])/i.test(t);
  if (hex && !/\b(tx|txn|transaction|hash|block)\b/i.test(t)) return "key";
  return null;
}

/** The whole check: what the input looks like, then the right reader. → { kind, level, title, lines } (or async-able facts via `needs`). */
export function check(raw, known = []) {
  const input = String(raw ?? "").trim();
  if (!input) return null;
  const n = input.split(/\s+/).length;
  if (SEED.test(input.toLowerCase()) && [12, 15, 18, 21, 24].includes(n))
    return { kind: "seed", level: "danger", title: "That looks like a seed phrase", lines: ["Never type it anywhere: whoever has it owns the wallet. This page sent it nowhere and cleared the box. If a site or a person asked for it, it is a scam.", TRICKS] };
  if (/^0x[0-9a-f]{40}$/i.test(input)) return { kind: "address", address: input, needs: "address", ...checkAddress(input, known) };
  if (/^0x[0-9a-f]{64}$/i.test(input))
    return { kind: "hash", level: "danger", title: "A blind signature", lines: ["Signing a bare 32-byte hash can authorize anything, and no wallet can show what. Unless you know exactly what produced it, don't sign it.", TRICKS] };
  if (/^0x[0-9a-f]{8,}$/i.test(input)) {
    const r = decodeCall({ data: input }, known);
    return { kind: "call", title: titleOf(r.level), ...r, lines: [...r.lines, "Paste the whole request (with its \"to\") for a precise answer."] };
  }
  if (/^[[{]/.test(input)) {
    let j;
    try {
      j = JSON.parse(input);
    } catch {
      return { kind: "json", level: "info", title: "Not readable", lines: ["It looks like data but isn't valid JSON. Paste the request exactly as the wallet or the site shows it."] };
    }
    if (Array.isArray(j)) j = j.find((x) => x && typeof x === "object") ?? (typeof j[1] === "string" ? safeJSON(j[1]) : null) ?? {};
    if (j.params) j = [j.params].flat().map((x) => (typeof x === "string" ? safeJSON(x) ?? x : x)).find((x) => x && typeof x === "object") ?? {};
    if (j.types && j.primaryType) {
      const r = decodeTypedData(j, known);
      return { kind: "typed", title: titleOf(r.level), ...r, lines: [...r.lines, r.level === "danger" ? TRICKS : CLEAN_NOTE] };
    }
    if (j.data || j.input || j.to) {
      const r = decodeCall({ to: j.to, data: j.data ?? j.input ?? "0x", value: j.value ?? 0 }, known);
      return { kind: "call", title: titleOf(r.level), ...r, lines: [...r.lines, r.level === "danger" ? TRICKS : CLEAN_NOTE] };
    }
    return { kind: "json", level: "info", title: "Not a request this check knows", lines: ["Paste a transaction (with \"to\" and \"data\") or a typed signature request (with \"types\" and \"primaryType\")."] };
  }
  if (!/\s/.test(input) && /\.[a-z]{2,}/i.test(input)) {
    const r = checkLink(input, known);
    if (r) return { kind: "link", ...r };
  }
  if (/wants you to sign in with your ethereum account/i.test(input)) {
    const domain = input.split(/\s/)[0].toLowerCase();
    const ours = domain === OFFICIAL_SITE;
    return { kind: "message", level: ours ? "ok" : imitates(domain) ? "danger" : "info", title: "A sign-in message", lines: [`It signs you in to ${domain}. Signing in moves nothing by itself.`, ours ? CLEAN_NOTE : imitates(domain) ? `${domain} imitates neonfaces.xyz.` : "Make sure that is the site you meant to use."] };
  }
  return { kind: "message", level: "info", title: "A text message", lines: ["Signing a readable text message moves nothing by itself. Read it to the end: if it mentions approvals, transfers or a long code, stop.", CLEAN_NOTE] };
}
function safeJSON(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
const titleOf = (level) => ({ ok: "Looks right", info: "What it does", warn: "Read before signing", danger: "Don't sign this" })[level];
