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

## Holder side

From the site: open `/face/<id>` with the holder wallet → **Your Face · controls** → *Delegate an agent* (address, days, ETH budget, one allowed call per line: `0xContract functionName(types)`). The panel warns before allowing selectors that can move assets (`transfer`, `transferFrom`, `approve`, `increaseAllowance`, `setApprovalForAll`, `safeTransferFrom`, `permit`).

Directly on-chain (holder = the Face owner, EOA or smart wallet):

```solidity
setAgent(address agent, uint64 expiry, Permission[] permissions, uint256 valueAllowance) // replaces everything
setAgentPermissions(Permission[] permissions, bool allowed)                                // add / remove calls
setAgentValueAllowance(uint256 valueAllowance)                                             // new ETH budget
revokeAgent()                                                                              // allowed even while locked
lock(uint64 until)                                                                         // max 365 days, extend only
```

Safe pattern for trading strategies: the holder approves a trusted router **once** with `execute`, then allows the agent only the router's swap function. Output tokens return to the Face account; nothing reaches the agent.

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
