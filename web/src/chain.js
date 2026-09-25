// Chain access for the NEONFACES site. No backend: everything is read from Robinhood Chain.
// `/deployment.json` (written by tools/export-web.mjs) holds addresses + chain; without it the site
// runs in preview mode (art previews only). Minting happens on OpenSea (SeaDrop), not here.
import { createPublicClient, createWalletClient, custom, http, parseAbi, defineChain, getAddress } from "viem";

export const ABI = {
  faces: parseAbi([
    "function totalSupply() view returns (uint256)",
    "function ownerOf(uint256) view returns (address)",
    "function balanceOf(address) view returns (uint256)",
    "function tokenURI(uint256) view returns (string)",
    "function revealSeed() view returns (uint256)",
    "function mintClosed() view returns (bool)",
  ]),
  payout: parseAbi(["function payees() view returns (address[4] accounts, uint256[4] shares)"]),
  seeder: parseAbi([
    "function seedOf(uint256) view returns ((address account, uint8 tier, uint32 basketId, uint32 upgradeBasketId, bool activated, bool funded, bool upgraded, (address token, uint256 amount)[] legs, (address token, uint256 amount)[] upgradeLegs))",
    "function fundedCount() view returns (uint256)",
    "function activatedCount() view returns (uint256)",
    "function activate(uint256 tokenId) returns (address)",
    "function fund(uint256 tokenId)",
    "function upgrade(uint256 tokenId)",
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
  ]),
};

export const TIERS = ["—", "Glance", "Watch", "Heavy Stare"];

export const state = {
  dep: null, // deployment.json
  chain: null, // viem chain
  pub: null, // public client
  wallet: null, // wallet client
  account: null,
  provider: null,
  preview: true,
};

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
    state.pub = createPublicClient({ chain: state.chain, transport: http(dep.chain.rpcUrl, { batch: true }) });
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

/** Faces held by `owner`, from the explorer's index (a convenience: [] when the explorer is unreachable). */
export async function facesOf(owner) {
  const base = state.dep?.chain?.explorer;
  if (!base) return [];
  const want = state.dep.faces.toLowerCase();
  const ids = [];
  let params = "";
  for (let page = 0; page < 20; page++) {
    const r = await fetch(`${base}/api/v2/addresses/${owner}/nft?type=ERC-721${params}`);
    if (!r.ok) break;
    const j = await r.json();
    for (const it of j.items ?? []) if (it.token?.address?.toLowerCase() === want) ids.push(Number(it.id));
    if (!j.next_page_params) break;
    params = "&" + new URLSearchParams(j.next_page_params).toString();
  }
  return ids.sort((a, b) => a - b);
}

/** tokenURI -> parsed JSON (data:application/json;base64,...) */
export async function metadata(tokenId) {
  const uri = await read("faces", "tokenURI", [BigInt(tokenId)]);
  const b64 = uri.slice(uri.indexOf(",") + 1);
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}
