// The scam guard on known drainer requests, lookalike links and addresses, fake tokens, and the official flows.
import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeFunctionData, parseAbi, maxUint256 } from "viem";
import { knownFrom, check, checkLink, checkAddress, addressFacts, decodeCall, decodeTypedData, imitates } from "../src/guard.js";

const dep = {
  faces: "0x67384d956ac12f2C4a69167BF0DC67A3F72C1C1B",
  seeder: "0xe00EAaC0ab3312dDB59069130D422ea8f09Cfc1E",
  trader: "0x93C02C45890616B2c63435E7E97Fb8B788B73610",
  seaDrop: "0x00005EA00Ac477B1030CE78506496e8C2dE24bf5",
  strategyAgent: "0x2A9100000000000000000000000000000000beef",
  tradeTokens: [
    { symbol: "NVDA", address: "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC" },
    { symbol: "WETH", address: "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73" },
  ],
};
const K = knownFrom(dep);
const EVIL = "0x1111111111111111111111111111111111111111";
const ABI = parseAbi([
  "function approve(address spender, uint256 amount)",
  "function setApprovalForAll(address operator, bool approved)",
  "function transferFrom(address from, address to, uint256 id)",
  "function mintPublic(address nftContract, address feeRecipient, address minterIfNotPayer, uint256 quantity)",
  "function executeBatch((address target, uint256 value, bytes data)[] calls, uint8 operation)",
  "function execute(address to, uint256 value, bytes data, uint8 operation)",
]);
const enc = (functionName, args) => encodeFunctionData({ abi: ABI, functionName, args });

test("links: the official ones, imitations and bait", () => {
  assert.equal(checkLink("https://neonfaces.xyz/face/12", K).level, "ok");
  assert.equal(checkLink("neonfaces.xyz", K).level, "ok");
  assert.equal(checkLink("https://www.neonfaces.xyz/", K).level, "ok");
  for (const bad of ["https://neonfaces-mint.xyz", "https://ne0nfaces.xyz", "neonfacez.com/claim", "https://neon-faces.io", "https://xn--nonfaces-y2a.xyz", "https://mint.neonfaces.app"])
    assert.equal(checkLink(bad, K).level, "danger", bad);
  assert.equal(checkLink("https://free.neonfaces.xyz", K).level, "warn");
  assert.equal(checkLink("https://opensea.io/collection/neonfaces", K).level, "ok");
  assert.equal(checkLink("https://opensea.io/collection/neonfaces-official", K).level, "danger");
  assert.equal(checkLink(`https://opensea.io/item/robinhood/${dep.faces}/65`, K).level, "ok");
  assert.equal(checkLink(`https://opensea.io/item/robinhood/${EVIL}/65`, K).level, "warn");
  assert.equal(checkLink("https://x.com/osaykancuno", K).level, "ok");
  assert.equal(checkLink("https://x.com/neonfaces_xyz", K).level, "danger");
  assert.equal(checkLink("https://example.com/airdrop-claim", K).level, "danger");
  assert.equal(checkLink("https://google.com", K).level, "info");
  assert.equal(checkLink("javascript:alert(1)", K).level, "danger");
  assert.ok(imitates("NE0NFACES"));
  assert.ok(!imitates("opensea"));
  assert.ok(!imitates("neon"));
});

test("addresses: official, lookalike, unknown, fake tokens and collections", () => {
  assert.equal(checkAddress(dep.faces, K).level, "ok");
  assert.equal(checkAddress(dep.faces.toLowerCase(), K).title, "Official NEONFACES");
  assert.equal(checkAddress("0x67389999999999999999999999999999999C1C1B", K).level, "danger");
  assert.equal(checkAddress(EVIL, K).level, "info");
  assert.equal(addressFacts({ code: true, name: "NEONFACES", symbol: "NEON" }, K).level, "danger");
  assert.equal(addressFacts({ code: true, name: "Nvidia", symbol: "NVDA" }, K).level, "danger");
  assert.equal(addressFacts({ code: true, name: "Visit neon-claim.com to claim", symbol: "CLAIM" }, K).level, "danger");
  assert.equal(addressFacts({ code: false }, K).level, "info");
  assert.equal(addressFacts({ code: true, name: "Some Token", symbol: "SOME" }, K).level, "info");
});

test("calls: approvals, operators, transfers", () => {
  assert.equal(decodeCall({ to: dep.tradeTokens[0].address, data: enc("approve", [EVIL, maxUint256]) }, K).level, "danger");
  assert.equal(decodeCall({ to: dep.tradeTokens[0].address, data: enc("approve", [dep.trader, 10n ** 18n]) }, K).level, "info");
  assert.match(decodeCall({ to: dep.tradeTokens[0].address, data: enc("approve", [EVIL, 0n]) }, K).lines[0], /revoke/);
  const all = decodeCall({ to: dep.faces, data: enc("setApprovalForAll", [EVIL, true]) }, K);
  assert.equal(all.level, "danger");
  assert.match(all.lines[0], /every NEONFACES in this wallet/);
  assert.equal(decodeCall({ to: dep.faces, data: enc("setApprovalForAll", ["0x1E0049783F008A0085193E00003D00cd54003c71", true]) }, K).level, "info");
  assert.match(decodeCall({ to: dep.faces, data: enc("transferFrom", [EVIL, EVIL, 65n]) }, K).lines[0], /NEONFACES #65/);
  assert.equal(decodeCall({ to: EVIL, data: "0xdeadbeef" }, K).level, "warn");
  assert.match(decodeCall({ to: EVIL, value: 10n ** 16n }, K).lines[0], /0\.01 ETH/);
});

test("the official mint, and a mint of something else", () => {
  const ok = decodeCall({ to: dep.seaDrop, value: 8n * 10n ** 15n, data: enc("mintPublic", [dep.faces, EVIL, "0x0000000000000000000000000000000000000000", 2n]) }, K);
  assert.equal(ok.level, "warn");
  assert.match(ok.lines[0], /mints 2 NEONFACES .* 0\.008 ETH: the official mint contract\. The mint is paused/);
  assert.equal(decodeCall({ to: dep.seaDrop, data: enc("mintPublic", [EVIL, EVIL, EVIL, 1n]) }, K).level, "danger");
  assert.equal(decodeCall({ to: EVIL, data: enc("mintPublic", [dep.faces, EVIL, EVIL, 1n]) }, K).level, "danger");
});

test("calls made by a Face account are read inside", () => {
  const inner = enc("approve", [EVIL, maxUint256]);
  const batch = decodeCall({ to: EVIL, data: enc("executeBatch", [[{ target: dep.tradeTokens[0].address, value: 0n, data: inner }, { target: dep.trader, value: 0n, data: "0x" }], 0]) }, K);
  assert.equal(batch.level, "danger");
  assert.ok(batch.lines.some((l) => /^· It lets 0x1111…1111 take any amount of NVDA/.test(l)), batch.lines.join("\n"));
  const one = decodeCall({ to: EVIL, data: enc("execute", [dep.faces, 0n, enc("setApprovalForAll", [EVIL, true]), 0]) }, K);
  assert.equal(one.level, "danger");
});

test("signatures: permits and Seaport orders", () => {
  const permit = { primaryType: "Permit", types: {}, domain: { verifyingContract: dep.tradeTokens[0].address }, message: { owner: EVIL, spender: EVIL, value: maxUint256.toString(), deadline: "1900000000" } };
  assert.equal(decodeTypedData(permit, K).level, "danger");
  const order = (paid) => ({
    primaryType: "OrderComponents",
    types: {},
    domain: {},
    message: {
      offerer: "0x2222222222222222222222222222222222222222",
      offer: [{ itemType: 2, token: dep.faces, identifierOrCriteria: "65", startAmount: "1" }],
      consideration: [{ itemType: 0, token: "0x0000000000000000000000000000000000000000", identifierOrCriteria: "0", startAmount: paid, recipient: "0x2222222222222222222222222222222222222222" }],
      endTime: "1900000000",
    },
  });
  assert.equal(decodeTypedData(order("1"), K).level, "danger");
  assert.equal(decodeTypedData(order(String(5n * 10n ** 16n)), K).level, "warn");
  assert.match(decodeTypedData(order("1"), K).lines[0], /you give item #65 of NEONFACES/);
});

test("check() sorts the input", () => {
  assert.equal(check("abandon ability able about above absent absorb abstract absurd abuse access accident").kind, "seed");
  assert.equal(check(dep.faces, K).kind, "address");
  assert.equal(check(`0x${"ab".repeat(32)}`, K).level, "danger");
  assert.equal(check("https://neonfaces.xyz", K).level, "ok");
  assert.equal(check(JSON.stringify({ to: dep.faces, data: enc("setApprovalForAll", [EVIL, true]) }), K).level, "danger");
  assert.equal(check(JSON.stringify({ method: "eth_signTypedData_v4", params: [EVIL, JSON.stringify({ primaryType: "Permit", types: {}, domain: {}, message: { spender: EVIL, value: "1" } })] }), K).kind, "typed");
  assert.equal(check("neonfaces.xyz wants you to sign in with your Ethereum account:\n0x…", K).level, "ok");
  assert.equal(check("Hello, sign this to prove you own the wallet", K).kind, "message");
  assert.equal(check("   "), null);
});
