// Chain access for the NEONFACES site. No backend: everything is read from Robinhood Chain.
// `/deployment.json` (written by tools/export-web.mjs) holds addresses + chain; without it the site
// runs in preview mode (art previews only). Minting happens on OpenSea (SeaDrop), not here.
import { createPublicClient, createTransport, createWalletClient, custom, http, parseAbi, defineChain, getAddress, shouldThrow } from "viem";

export const ABI = {
  faces: parseAbi([
    "function totalSupply() view returns (uint256)",
    "function ownerOf(uint256) view returns (address)",
    "function balanceOf(address) view returns (uint256)",
    "function tokenURI(uint256) view returns (string)",
    "function revealSeed() view returns (uint256)",
    "function mintClosed() view returns (bool)",
    "function heldSince(uint256 tokenId) view returns (uint64)",
    "function safeTransferFrom(address from, address to, uint256 tokenId)",
    "function transferFrom(address from, address to, uint256 tokenId)",
    "function assembleSet(uint256 anchorId)",
    "error NotYourPiece(uint256 tokenId)",
    "error OwnershipCycle()",
    "error FaceAccountLocked()",
    "error SetIsFused()",
  ]),
  setVotes: parseAbi([
    "function pollCount() view returns (uint256)",
    "function poll(uint256 pollId) view returns (string question, string[] choices, uint64 start, uint64 end, uint256 votes, uint256[] counts)",
    "function voteOf(uint256 pollId, uint256 setId) view returns (uint256)",
    "function vote(uint256 pollId, uint256 anchorId, uint256 choice)",
    "error PollClosed(uint256 pollId)",
    "error NotTheHolder()",
    "error SetNotAssembled(uint256 anchorId)",
  ]),
  payout: parseAbi(["function payees() view returns (address[4] accounts, uint256[4] shares)"]),
  seedVault: parseAbi([
    "function restock(address[] path, uint24[] fees) returns (uint256)",
    "function restockAndDeliver(uint8 action, uint256 tokenId, address[][] paths, uint24[][] fees)",
    "error NothingToRestock(address token)",
    "error VaultEmpty()",
    "error MarketOffPrice(address token)",
    "error StalePrice(address token, uint256 updatedAt)",
    // the seeder's, bubbling up through restockAndDeliver
    "error InsufficientPool(address token, uint256 needed, uint256 available)",
    "error NotUpgradeable(uint256 tokenId)",
    "error AlreadyFunded()",
    "error SetNotAssembled(uint256 anchorId)",
    "error SetBonusAlreadyPaid(uint256 setId)",
  ]),
  seeder: parseAbi([
    "function seedOf(uint256) view returns ((address account, uint8 tier, uint32 basketId, uint32 upgradeBasketId, bool activated, bool funded, bool upgraded, (address token, uint256 amount)[] legs, (address token, uint256 amount)[] upgradeLegs))",
    "function fundedCount() view returns (uint256)",
    "function activatedCount() view returns (uint256)",
    "function activate(uint256 tokenId) returns (address)",
    "function fund(uint256 tokenId)",
    "function upgrade(uint256 tokenId)",
    "function artIdOf(uint256 tokenId) view returns (uint256)",
    "function setOf(uint256 tokenId) view returns (uint256 setId, uint256 piece, uint256[4] members)",
    "function isAssembled(uint256 anchorId) view returns (bool)",
    "function setBonusDue(uint256 anchorId) view returns (bool)",
    "function fuse(uint256 anchorId)",
    "function fusedSet(uint256 setId) view returns (uint32 anchorId, uint64 at)",
    "function fusedCount() view returns (uint256)",
    "event SetFused(uint256 indexed setId, uint256 indexed anchorId)",
    "error NotTheHolder()",
    "error SetAlreadyFused(uint256 setId)",
    "function setBonus(uint256 setId) view returns (uint32 anchorId, uint32 basketId)",
    "function accountOf(uint256 tokenId) view returns (address)",
    "function claimSetBonus(uint256 anchorId)",
    "function basket(uint32 basketId) view returns ((address token, uint256 amount)[])",
    "error SetNotAssembled(uint256 anchorId)",
    "error SetBonusAlreadyPaid(uint256 setId)",
    "error InsufficientPool(address token, uint256 needed, uint256 available)",
    "error NotUpgradeable(uint256 tokenId)",
    "error AlreadyFunded()",
  ]),
  art: parseAbi([
    "function isSealed() view returns (bool)",
    "function artData(uint256 artId) view returns (bytes)",
  ]),
  account: parseAbi([
    "function agentConfig() view returns (address agent, address grantor, uint64 expiry, bool active, uint256 valueAllowance)",
    "function owner() view returns (address)",
    "function lockedUntil() view returns (uint64)",
    "function effectiveLockedUntil() view returns (uint64)",
    "function holder() view returns (address)",
    "function token() view returns (uint256 chainId, address tokenContract, uint256 tokenId)",
    "function isAgentCallAllowed(address target, bytes4 selector) view returns (bool)",
    "function setAgent(address agent, uint64 expiry, (address target, bytes4 selector)[] permissions, uint256 valueAllowance)",
    "function setAgentPermissions((address target, bytes4 selector)[] permissions, bool allowed)",
    "function setAgentValueAllowance(uint256 valueAllowance)",
    "function revokeAgent()",
    "function lock(uint64 until)",
    "event AgentPermissionsUpdated(uint64 indexed epoch, (address target, bytes4 selector)[] permissions, bool allowed)",
    "error AccountIsLocked(uint64 until)",
    "error InvalidAgentConfig()",
    "error InvalidLock()",
    "error Unauthorized()",
  ]),
  accountExec: parseAbi([
    "function executeBatch((address target, uint256 value, bytes data)[] calls, uint8 operation) payable returns (bytes[])",
    "error AccountIsLocked(uint64 until)",
    "error Unauthorized()",
  ]),
  erc20: parseAbi([
    "function balanceOf(address) view returns (uint256)",
    "function symbol() view returns (string)",
    "function decimals() view returns (uint8)",
    "function allowance(address owner, address spender) view returns (uint256)",
  ]),
};

export const TIERS = ["Unrevealed", "Glance", "Watch", "Heavy Stare"];

export const state = {
  dep: null, // deployment.json
  chain: null, // viem chain
  pub: null, // public client
  wallet: null, // wallet client
  account: null,
  provider: null,
  preview: true,
};

/**
 * Reads go to the chain's official node; when it fails or rate-limits, to the keyless fallbacks in order. In the
 * launch days thousands of browsers read at once: a "Too Many Requests" (HTTP 429, or a JSON-RPC 429 in a 200) clears
 * in about 2 s on the official node (measured 27 Sep). Each node retries twice (0.5 s, 1 s), then the next one
 * answers. dRPC's free tier refuses JSON-RPC batches: single requests there.
 */
function transport(chain) {
  const opts = { retryCount: 2, retryDelay: 500 };
  // since 2 Oct the official node answers browsers with a doubled CORS header ("*,*"), which every browser refuses:
  // the site reads from the fallbacks first and keeps the official node behind them (wallets still add the chain with
  // the official URL, where CORS doesn't apply)
  const fallbacks = chain.rpcFallbacks ?? [];
  const urls = [...fallbacks.filter((u) => !u.includes("drpc.org")), chain.rpcUrl, ...fallbacks.filter((u) => u.includes("drpc.org"))];
  const nodes = urls.map((u) => http(u, { ...opts, batch: !u.includes("drpc.org") }));
  return nodes.length > 1 ? sticky(nodes) : nodes[0];
}

/**
 * viem's fallback starts from the first node on every request, so with the official node down each read would wait
 * for its retries (a Face page took 27 s in the test of 27 Sep). This one stays on the node that answered for a
 * minute, then tries the official node again. Contract errors (a revert) and wallet refusals are answers, not
 * failures: they are thrown at once, as viem's own fallback does (`shouldThrow`).
 */
function sticky(list, stayMs = 60_000) {
  let preferred = 0;
  let until = 0;
  return ({ chain, ...rest }) => {
    const nodes = list.map((t) => t({ chain, ...rest, retryCount: undefined }));
    return createTransport({
      key: "sticky",
      name: "Sticky fallback",
      type: "fallback",
      retryCount: 0,
      async request(args) {
        const start = Date.now() < until ? preferred : 0;
        let last;
        for (let k = 0; k < nodes.length; k++) {
          const i = (start + k) % nodes.length;
          try {
            const res = await nodes[i].request(args);
            if (i !== start) [preferred, until] = i === 0 ? [0, 0] : [i, Date.now() + stayMs];
            return res;
          } catch (e) {
            if (shouldThrow(e)) throw e;
            last = e;
          }
        }
        throw last;
      },
    });
  };
}

export async function loadDeployment() {
  try {
    const r = await fetch("/deployment.json", { cache: "no-store" });
    if (!r.ok) throw new Error("no deployment");
    const dep = await r.json();
    state.dep = dep;
    state.chain = defineChain({
      id: dep.chain.id,
      name: dep.chain.name,
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: [dep.chain.rpcUrl] } },
      blockExplorers: dep.chain.explorer ? { default: { name: "Blockscout", url: dep.chain.explorer } } : undefined,
    });
    state.pub = createPublicClient({ chain: state.chain, transport: transport(dep.chain) });
    state.preview = false;
  } catch {
    state.preview = true;
  }
  return state;
}

export const read = (contract, functionName, args = []) =>
  state.pub.readContract({ address: state.dep[contract], abi: ABI[contract], functionName, args });

export const readAt = (address, abiName, functionName, args = []) =>
  state.pub.readContract({ address, abi: ABI[abiName], functionName, args });

export function explorer(path) {
  return state.dep?.chain?.explorer ? `${state.dep.chain.explorer}/${path}` : null;
}

// ------------------------------------------------------------------ wallets (EIP-6963)
const discovered = new Map();
window.addEventListener("eip6963:announceProvider", (e) => discovered.set(e.detail.info.uuid, e.detail));
window.dispatchEvent(new Event("eip6963:requestProvider"));

export function wallets() {
  const list = [...discovered.values()];
  if (!list.length && window.ethereum) list.push({ info: { name: "Browser wallet", icon: "", uuid: "injected" }, provider: window.ethereum });
  return list;
}

export async function connect(provider) {
  const [addr] = await provider.request({ method: "eth_requestAccounts" });
  state.provider = provider;
  state.account = getAddress(addr);
  state.wallet = createWalletClient({ account: state.account, chain: state.chain, transport: custom(provider) });
  provider.on?.("accountsChanged", (a) => {
    state.account = a[0] ? getAddress(a[0]) : null;
    if (state.wallet && state.account) state.wallet = createWalletClient({ account: state.account, chain: state.chain, transport: custom(provider) });
    window.dispatchEvent(new CustomEvent("neon:account"));
  });
  provider.on?.("chainChanged", () => window.dispatchEvent(new CustomEvent("neon:account")));
  window.dispatchEvent(new CustomEvent("neon:account"));
  return state.account;
}

/** Make sure the wallet is on the collection's chain, adding Robinhood Chain if unknown. */
export async function ensureChain() {
  const want = "0x" + state.chain.id.toString(16);
  const current = await state.provider.request({ method: "eth_chainId" });
  if (current?.toLowerCase() === want) return;
  try {
    await state.provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: want }] });
  } catch (e) {
    if (e?.code !== 4902 && !String(e?.message).includes("Unrecognized")) throw e;
    await state.provider.request({
      method: "wallet_addEthereumChain",
      params: [{
        chainId: want,
        chainName: state.dep.chain.name,
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        rpcUrls: [state.dep.chain.rpcUrl],
        blockExplorerUrls: state.dep.chain.explorer ? [state.dep.chain.explorer] : [],
      }],
    });
  }
}

export function short(a) {
  return a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "";
}

/** Faces held by `owner`, read from the chain: token ids run 1..totalSupply, so its balance tells how many to find and
 * ownerOf is asked in batches until they are all found (the explorer's API refuses the site's requests: 403, 2 Oct). */
export async function facesOf(owner) {
  const [total, balance] = await Promise.all([read("faces", "totalSupply"), read("faces", "balanceOf", [owner])]);
  const want = Number(balance), last = Number(total), me = owner.toLowerCase();
  const ids = [];
  for (let from = 1; from <= last && ids.length < want; from += 200) {
    const batch = Array.from({ length: Math.min(200, last - from + 1) }, (_, i) => from + i);
    const owners = await Promise.all(batch.map((id) => read("faces", "ownerOf", [BigInt(id)]).catch(() => null)));
    owners.forEach((o, i) => o && o.toLowerCase() === me && ids.push(batch[i]));
  }
  return ids;
}

/** tokenURI -> parsed JSON (data:application/json;base64,...) */
export async function metadata(tokenId) {
  const uri = await read("faces", "tokenURI", [BigInt(tokenId)]);
  const b64 = uri.slice(uri.indexOf(",") + 1);
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}
