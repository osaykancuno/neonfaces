// Plan B, the one transaction the sale manager signs: configure the SeaDrop stages on NeonFaces (multiConfigure,
// the same call OpenSea Studio makes), from a page served on this computer only.
//
//   node tools/seadrop-drop.mjs 4663          # first: builds the calldata from the list
//   node tools/configure-drop.mjs 4663 [--rpc http://127.0.0.1:8549] [--port 8787]
//   -> open http://127.0.0.1:8787 in the browser where the sale manager's wallet is
//
// The page shows every term in plain words, checks that the connected wallet is the sale manager, simulates the call
// (a transaction that would fail is never offered), sends it, then reads SeaDrop back and checks each value against
// the plan. No key ever touches this script: the wallet signs. It listens on 127.0.0.1 only.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { encodeFunctionData, encodeAbiParameters, parseAbi, getAddress, formatEther } from "viem";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const chainId = Number(process.argv[2] ?? 4663);
const arg = (k, d) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : d;
};
const RPC = arg("--rpc", { 4663: "https://rpc.mainnet.chain.robinhood.com", 46630: "https://rpc.testnet.chain.robinhood.com" }[chainId]);
const PORT = Number(arg("--port", "8787"));
const planFile = path.join(ROOT, `config/allowlists/opensea/drop.${chainId}.json`);
if (!fs.existsSync(planFile)) throw new Error(`${planFile} is missing: run node tools/seadrop-drop.mjs ${chainId} first`);
const plan = JSON.parse(fs.readFileSync(planFile, "utf8"));
const dep = JSON.parse(fs.readFileSync(path.join(ROOT, `contracts/deployments/${chainId}.json`), "utf8"));
if (getAddress(plan.faces) !== getAddress(dep.faces) || getAddress(plan.to) !== getAddress(dep.faces)) throw new Error("the plan is for another NeonFaces");

const SD = parseAbi([
  "function getAllowListMerkleRoot(address) view returns (bytes32)",
  "function getPublicDrop(address) view returns ((uint80 mintPrice, uint48 startTime, uint48 endTime, uint16 maxTotalMintableByWallet, uint16 feeBps, bool restrictFeeRecipients))",
  "function getCreatorPayoutAddress(address) view returns (address)",
  "function getAllowedFeeRecipients(address) view returns (address[])",
]);
const NF = parseAbi(["function saleManager() view returns (address)"]);
const read = (label, to, abi, functionName, args, expect) => ({ label, to, data: encodeFunctionData({ abi, functionName, args }), expect: expect.toLowerCase() });
const P = plan.public;
const checks = [
  read("List: Merkle root", plan.seaDrop, SD, "getAllowListMerkleRoot", [plan.faces], plan.root),
  read(
    "Public stage",
    plan.seaDrop,
    SD,
    "getPublicDrop",
    [plan.faces],
    encodeAbiParameters(
      [{ type: "tuple", components: ["uint80", "uint48", "uint48", "uint16", "uint16", "bool"].map((type) => ({ type })) }],
      [[BigInt(P.mintPrice), Number(P.startTime), Number(P.endTime), Number(P.maxTotalMintableByWallet), Number(P.feeBps), P.restrictFeeRecipients]],
    ),
  ),
  read("Payout: NeonPayout", plan.seaDrop, SD, "getCreatorPayoutAddress", [plan.faces], encodeAbiParameters([{ type: "address" }], [dep.payout])),
  read("Fee recipient: OpenSea", plan.seaDrop, SD, "getAllowedFeeRecipients", [plan.faces], encodeAbiParameters([{ type: "address[]" }], [[plan.feeRecipient]])),
];
const saleManagerCall = encodeFunctionData({ abi: NF, functionName: "saleManager" });
const utc = (t) => new Date(Number(t) * 1000).toISOString().replace("T", " ").slice(0, 16) + " UTC";
const terms = [
  ["Contract", `NeonFaces ${plan.faces}`],
  ["Sale manager", "the connected wallet must be it"],
  ["List stage", `${formatEther(BigInt(plan.list.mintPrice))} ETH, up to ${plan.list.maxTotalMintableByWallet} per wallet, ${utc(plan.list.startTime)} to ${utc(plan.list.endTime)}, ${plan.wallets.toLocaleString("en-US")} wallets (root ${plan.root.slice(0, 10)}…)`],
  ["Public stage", `${formatEther(BigInt(P.mintPrice))} ETH, up to ${P.maxTotalMintableByWallet} per wallet in total, ${utc(P.startTime)} to ${utc(P.endTime)}`],
  ["OpenSea fee", `${Number(P.feeBps) / 100}% to ${plan.feeRecipient} (restricted)`],
  ["Payout", `NeonPayout ${dep.payout} (the only address NeonFaces accepts)`],
];

const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Configure the drop</title>
<style>
:root{--neon:#ccff00;--bg:#000;--text:#e9f5c4;--dim:#8a9a5a;--line:#2a320a}
body{margin:0;background:var(--bg);color:var(--text);font:15px/1.55 ui-monospace,Menlo,Consolas,monospace;padding:24px 16px}
main{max-width:760px;margin:0 auto}h1{color:var(--neon);font-size:22px;letter-spacing:2px;margin:0 0 6px}
p{margin:8px 0}.dim{color:var(--dim)}dl{border:1px solid var(--line);padding:12px 16px;margin:18px 0}
dt{color:var(--neon);margin-top:8px}dd{margin:0 0 0 0;word-break:break-all}
button{background:var(--neon);color:#000;border:0;font:inherit;font-weight:700;padding:14px 20px;cursor:pointer;margin:6px 8px 6px 0}
button:disabled{opacity:.35;cursor:not-allowed}#log{white-space:pre-wrap;border:1px solid var(--line);padding:12px;min-height:3em;margin-top:14px}
.ok{color:var(--neon)}.bad{color:#ff5d7a}
</style></head><body><main>
<h1>NEONFACES · configure the drop</h1>
<p class="dim">One transaction from the sale manager. It sets both SeaDrop stages on NeonFaces, the call OpenSea Studio would make. Nothing else changes; it can be sent again later with a new plan.</p>
<dl>${terms.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl>
<button id="connect">Connect wallet</button><button id="send" disabled>Configure the drop</button><button id="check">Read SeaDrop now</button>
<div id="log"></div>
</main><script>
const PLAN = ${JSON.stringify({ chainId, rpc: RPC, to: plan.to, data: plan.data, checks, saleManagerCall })};
const log = (t, c = "") => { const d = document.createElement("div"); d.className = c; d.textContent = t; document.getElementById("log").appendChild(d); };
const rpc = async (method, params) => { const r = await fetch(PLAN.rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) }); const j = await r.json(); if (j.error) throw new Error(j.error.message + (j.error.data ? " " + j.error.data : "")); return j.result; };
let account = null;
async function check() {
  let all = true;
  for (const c of PLAN.checks) {
    const got = (await rpc("eth_call", [{ to: c.to, data: c.data }, "latest"])).toLowerCase();
    const ok = got === c.expect;
    all = all && ok;
    log((ok ? "PASS  " : "not yet  ") + c.label, ok ? "ok" : "dim");
  }
  log(all ? "Every stage value on SeaDrop matches the plan." : "SeaDrop doesn't hold the plan yet.", all ? "ok" : "dim");
  return all;
}
document.getElementById("check").onclick = () => check().catch((e) => log(e.message, "bad"));
document.getElementById("connect").onclick = async () => {
  try {
    if (!window.ethereum) return log("No browser wallet found.", "bad");
    [account] = await ethereum.request({ method: "eth_requestAccounts" });
    const want = "0x" + PLAN.chainId.toString(16);
    if ((await ethereum.request({ method: "eth_chainId" })).toLowerCase() !== want) await ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: want }] });
    const manager = "0x" + (await rpc("eth_call", [{ to: PLAN.to, data: PLAN.saleManagerCall }, "latest"])).slice(-40);
    if (manager.toLowerCase() !== account.toLowerCase()) return log("Connected " + account + ", but the sale manager is " + manager + ". Switch account in the wallet and connect again.", "bad");
    log("Connected: the sale manager " + account, "ok");
    await rpc("eth_call", [{ from: account, to: PLAN.to, data: PLAN.data }, "latest"]);
    log("Dry run: ok, the transaction would succeed.", "ok");
    document.getElementById("send").disabled = false;
  } catch (e) { log(e.message, "bad"); }
};
document.getElementById("send").onclick = async () => {
  const b = document.getElementById("send");
  b.disabled = true;
  try {
    const hash = await ethereum.request({ method: "eth_sendTransaction", params: [{ from: account, to: PLAN.to, data: PLAN.data, value: "0x0" }] });
    log("Sent " + hash + ". Waiting for the chain…");
    let r = null;
    while (!r) { await new Promise((ok) => setTimeout(ok, 1500)); r = await rpc("eth_getTransactionReceipt", [hash]); }
    log(r.status === "0x1" ? "Confirmed in block " + parseInt(r.blockNumber) + "." : "Reverted: nothing changed.", r.status === "0x1" ? "ok" : "bad");
    await check();
  } catch (e) { log(e.message, "bad"); b.disabled = false; }
};
</script></body></html>`;

http
  .createServer((req, res) => {
    if (req.url !== "/") return res.writeHead(404).end();
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }).end(page);
  })
  .listen(PORT, "127.0.0.1", () => {
    console.log(`Configure the drop: open http://127.0.0.1:${PORT} with the sale manager's wallet (Ctrl+C to stop)`);
    console.log(`reads ${RPC}; ${plan.wallets} wallets on the list, root ${plan.root}`);
  });
