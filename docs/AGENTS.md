# Agents on a NEONFACES account

Every Face owns an ERC-6551 account (`NeonFaceAccount`). The holder can delegate **one agent** — a bot key, a strategy contract, an AI agent — that acts on the account within rules the holder sets. The holder stays the owner; the agent is only an executor.

## Rules the contract enforces

| Rule | Detail |
|---|---|
| Allowed calls only | a list of `(target contract, function selector)` pairs set by the holder |
| ETH budget | total wei the agent may spend from the account; decremented on use, reset by the holder |
| No signatures | ERC-1271 / `isValidSigner` never accept the agent |
| Never the account itself | the account can't be a target (no self-reconfiguration) |
| Expiry | every delegation has an end date |
| Dies on sale | a delegation is bound to the holder who granted it; any transfer of the Face voids it |
| Lock wins | while the account is locked, agent calls revert |
| Atomic batches | `executeBatchAsAgent` succeeds or reverts as a whole |

## Holder side (no code needed)

On the site, open `/face/<id>` with the wallet that holds the Face. The **Your Face · controls** panel walks through four steps in plain language:

1. **Paste your agent's address** — the app or AI service you use shows it to you.
2. **What can it do?** — tick ready-made actions (e.g. "Buy Stock Tokens with ETH", "Swap between Stock Tokens"), each with a one-line explanation and a risk badge.
3. **For how long?** — 1, 7, 30 or 90 days.
4. **How much ETH can it spend, at most?** — 0 / 0.01 / 0.05 / 0.1 ETH or a custom amount, taken only from the Face's wallet.

A summary in plain sentences appears before signing (1 transaction, or 2 when an action needs a one-time token approval). Afterwards the panel shows what the agent can do, the ETH left and the end date, with **Stop the agent now** and **Change the spending limit**. "Selling this Face? Lock its wallet" offers ready durations. An **Advanced** box accepts raw `0xContract functionName(types)` lines for developers and warns before risky functions.

### Publishing ready-made actions (team, before launch)

Copy `config/agent-presets.example.json` to `config/agent-presets.<chainId>.json` and list only **verified** contracts (e.g. the chain's main DEX router and the Stock Token addresses). `node tools/export-web.mjs <chainId>` publishes them to the site. Rules:
- `risk: "low"` only when results can only come back into the Face (swaps through a trusted router); anything that can send assets elsewhere is `"careful"`.
- `approvals` are granted once by the holder (max allowance to the listed spender) in the same flow.
- Keep titles and `plain` sentences free of jargon; never mention returns.

### Direct contract calls (developers)

```solidity
setAgent(address agent, uint64 expiry, Permission[] permissions, uint256 valueAllowance) // replaces everything
setAgentPermissions(Permission[] permissions, bool allowed)                                // add / remove calls
setAgentValueAllowance(uint256 valueAllowance)                                             // new ETH budget
revokeAgent()                                                                              // allowed even while locked
lock(uint64 until)                                                                         // max 365 days, extend only
```

## Agent side

```solidity
executeAsAgent(address target, uint256 value, bytes data) returns (bytes)
executeBatchAsAgent(Call[] calls) returns (bytes[])        // Call = (address target, uint256 value, bytes data)

agentConfig() returns (address agent, address grantor, uint64 expiry, bool active, uint256 valueAllowance)
isAgentCallAllowed(address target, bytes4 selector) returns (bool)   // false while locked
lockedUntil() returns (uint64)
```

Find the account of a Face with `NeonSeeder.accountOf(tokenId)`.

Reference loop: [`tools/agent-example.mjs`](../tools/agent-example.mjs) — locate the account, check `agentConfig().active`, check the lock and `isAgentCallAllowed`, check the budget, simulate, send.

```bash
AGENT_PK=<delegated key> node tools/agent-example.mjs 4663 42 0xRouter "swap(address,address,uint256)" 0xTSLA 0xUSDG 1000000000000000
```

## Errors

| Error | Meaning |
|---|---|
| `AgentNotActive()` | caller isn't the agent, delegation expired / revoked, or the Face changed hands |
| `AgentCallNotAllowed(target, selector)` | that function on that contract isn't allowed |
| `AgentValueExceeded(requested, remaining)` | ETH budget too low |
| `AccountIsLocked(until)` | the holder locked the account |
| `InvalidAgentConfig()` | zero / self agent, past expiry, account as target |
