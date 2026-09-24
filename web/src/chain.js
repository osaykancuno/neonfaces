// Chain access for the NEONFACES site. No backend: everything is read from Robinhood Chain.
// `/deployment.json` (written by tools/export-web.mjs) holds addresses + chain; without it the site
// runs in preview mode (art previews, no mint).
import { createPublicClient, createWalletClient, custom, http, parseAbi, defineChain, getAddress } from "viem";

export const ABI = {
  faces: parseAbi([
    "function totalSupply() view returns (uint256)",
    "function ownerOf(uint256) view returns (address)",
    "function balanceOf(address) view returns (uint256)",
    "function tokenURI(uint256) view returns (string)",
    "function revealSeed() view returns (uint256)",
    "function mintPaused() view returns (bool)",
    "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
  ]),
  minter: parseAbi([
    "function mint(uint256 quantity, uint256 allowance, bytes32[] proof) payable returns (uint256)",
    "function phase() view returns (uint8)",
    "function phaseConfig(uint8) view returns (uint128 price, uint32 maxPerWallet, uint32 supplyCap, uint32 minted, bytes32 merkleRoot)",
    "function mintedBy(uint8, address) view returns (uint256)",
    "function payees() view returns (address[4] accounts, uint256[4] shares)",
    "event Minted(address indexed to, uint8 indexed phase, uint256 firstId, uint256 quantity, uint256 paid)",
    "error SaleNotActive()",
    "error InvalidQuantity()",
    "error WrongPayment(uint256 expected)",
    "error NotAllowlisted()",
    "error WalletLimit()",
    "error PhaseSoldOut()",
    "error MintIsPaused()",
    "error ExceedsPublicAllocation()",
  ]),
  seeder: parseAbi([
    "function seedOf(uint256) view returns ((address account, uint8 tier, uint16 tierIndex, uint32 basketId, bool activated, bool funded, (address token, uint256 amount)[] legs))",
    "function fundedCount() view returns (uint256)",
    "function activatedCount() view returns (uint256)",
    "function activate(uint256 tokenId) returns (address)",
    "function fund(uint256 tokenId)",
  ]),
  art: parseAbi([
    "function isSealed() view returns (bool)",
    "function artData(uint256 artId) view returns (bytes)",
  ]),
  account: parseAbi([
    "function agentConfig() view returns (address agent, address grantor, uint64 expiry, bool active)",
    "function owner() view returns (address)",
  ]),
  erc20: parseAbi([
    "function balanceOf(address) view returns (uint256)",
    "function symbol() view returns (string)",
    "function decimals() view returns (uint8)",
  ]),
};

export const PHASES = ["Closed", "Builders", "Allowlist", "Public", "Finished"];
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

/** tokenURI -> parsed JSON (data:application/json;base64,...) */
export async function metadata(tokenId) {
  const uri = await read("faces", "tokenURI", [BigInt(tokenId)]);
  const b64 = uri.slice(uri.indexOf(",") + 1);
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}
