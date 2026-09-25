# Agents on a NEONFACES account

Every Face owns an ERC-6551 account (`NeonFaceAccount`). The holder can delegate **one agent** (a bot key, a strategy contract, an AI agent) that acts on the account within rules the holder sets. The holder stays the owner; the agent is only an executor.

Three ways to put a Face to work, from the simplest:
1. **Ready-made strategies** run by the **NEONFACES strategy agent** (no bot of your own): accumulate a ticker, keep a share in USDG, trim a ticker that grew too big. See "Strategies" below.
2. **Talk to your Face** from an AI assistant: the MCP kit or `llms.txt` let any assistant read a Face and prepare actions as links the holder confirms. See "AI assistants" below.
3. **Your own agent**: any address, with ready-made or advanced permissions (the wizard below).

## Rules the contract enforces

| Rule | Detail |
|---|---|
| Allowed calls only | a list of `(target contract, function selector)` pairs set by the holder |
| ETH budget | total wei the agent may spend from the account; decremented on use, reset by the holder |
| No signatures | ERC-1271 / `isValidSigner` never accept the agent |
| Never the account itself | the account can't be a target (no self-reconfiguration) |
| Expiry | every delegation has an end date |
| Dies on sale | a delegation is bound to the holder who granted it; any transfer of the Face voids it |
| Lock wins | while the account is locked (or the Face it sits inside is), agent calls revert |
| Bound to the top holder | a Face inside another Face's account answers to the outer Face's holder (`holder()`): selling the outer Face voids agents on the pieces too |
| Atomic batches | `executeBatchAsAgent` succeeds or reverts as a whole |

## Holder side (no code needed)

On the site, open `/face/<id>` with the wallet that holds the Face. The **Your Face · controls** panel walks through four steps in plain language:

1. **Paste your agent's address** — the app or AI service you use shows it to you.
2. **What can it do?** — tick ready-made actions (e.g. "Buy Stock Tokens with ETH", "Swap between Stock Tokens"), each with a one-line explanation and a risk badge.
3. **For how long?** — 1, 7, 30 or 90 days.
4. **How much ETH can it spend, at most?** — 0 / 0.01 / 0.05 / 0.1 ETH or a custom amount, taken only from the Face's wallet.

A summary in plain sentences appears before signing (1 transaction, or 2 when an action needs a one-time token approval). Afterwards the panel shows what the agent can do, the ETH left and the end date, with **Stop the agent now** and **Change the spending limit**. "Selling this Face? Lock its wallet" offers ready durations. An **Advanced** box accepts raw `0xContract functionName(types)` lines for developers and warns before risky functions.

### Trading safely: NeonTrader

Never allow an agent to call a DEX router directly: a router's swap takes a `recipient` and a minimum output, so the agent could pay itself or accept any price. The published action allows only **`NeonTrader.swap`**, which enforces on-chain:
- the output is always paid to the calling Face account;
- minimum output from Chainlink: at most 1% below the oracle price after pool fees, with pool fees counted up to 1% (so never more than 2% below the oracle);
- only the Stock Tokens, USDG and ETH listed in `config/trader.4663.json` (verified feeds and Uniswap v3 pools);
- prices older than 26 h are refused (equity feeds pause at weekends, so trading does too);
- a daily USD cap the holder sets in the wizard (`setDailyLimit`, called by the account itself).

The holder's one-time setup (in the wizard's first transaction) approves NeonTrader for the listed tokens — safe because NeonTrader only ever pulls from and pays the caller.

## Strategies and the NEONFACES strategy agent

A strategy is a standing instruction stored on `NeonTrader` for the Face's account (`setStrategy`, called by the account, so by the holder); `strategyOf(account)` reads it. It is an instruction, not a permission: every trade still passes NeonTrader's rules.

| kind | name | fields | what the agent does |
|---|---|---|---|
| 1 | Accumulate | `token`, `funding` (USDG or WETH = ETH), `usd8`, `every` | buys `usd8` dollars of `token` with `funding` once per `every` |
| 2 | Keep liquid | `token` (USDG), `bps`, `every` | when USDG is more than 2 points under `bps` of the Face's value, sells the largest holding up to the target |
| 3 | Trim | `token`, `funding` (USDG), `bps`, `every` | when `token` is more than 2 points above `bps` of the Face's value, sells the excess into USDG |

`every` is at least 1 hour. Moves under $1 are skipped, the holder's daily USD cap limits each move, and stale prices (weekends) pause everything.

**The strategy agent** is `tools/agent-runner.mjs` with its own key (`RUNNER_PK`; its address is published as `strategyAgent` in the site's `deployment.json`). It runs every 10 minutes in `.github/workflows/keeper.yml`, finds accounts through `StrategySet` events, and acts only where the account's current agent is its own address, the account isn't locked and the strategy is due. It trades with **`swapWithNote`**, which emits `Note(account, text)` (≤ 96 bytes): the Face's journal shows each trade with its reason ("accumulate TSLA: $10.00 every 1w"). On the Face page, **Let this Face follow a strategy** sets everything in two transactions: (1) approvals + daily cap + `setStrategy`, (2) `setAgent(strategyAgent, expiry, [NeonTrader.swapWithNote], ETH budget)`. Stopping: **Stop the agent now** (or selling the Face).

What a stolen strategy-agent key could do: only `swapWithNote` on Faces that delegated to it, inside NeonTrader's rules (at most 2% under Chainlink, output back into the Face, the holder's daily cap). Holders revoke it in one click; the team rotates the key and republishes `strategyAgent`.

## AI assistants: talk to your Face

- **MCP kit**: `https://neonfaces.xyz/neonfaces-mcp.mjs` (source `web/public/neonfaces-mcp.mjs`), one file, Node 18+, no dependencies. Add it to Claude Desktop (`"mcpServers": { "neonfaces": { "command": "node", "args": ["/path/neonfaces-mcp.mjs"] } }`) or any MCP client. Tools: `face` (holdings with USD values, traits, set, Gaze, agent, strategy, lock), `prices`, `faces_of`, `prepare_action`. It reads the chain only; `NEONFACES_SITE` and `RPC_URL` override the defaults.
- **`llms.txt`**: `https://neonfaces.xyz/llms.txt` (source `web/public/llms.txt`), the same guide for any assistant.
- **Action links**: `https://neonfaces.xyz/face/<id>?do=trade|withdraw|lock|strategy|stop-agent&...` (format in `llms.txt` and `web/src/actions.js`). The Face page shows the action in plain words under **Prepared for you**; nothing is sent until the holder confirms. By construction a link can only trade through NeonTrader, withdraw to the connected holder's own wallet, lock, set a strategy for the published strategy agent, or revoke the agent: it can never name a recipient or another agent.

The same page also has **Withdraw or trade what's inside** for holders who act themselves (a holder trade raises the daily cap if needed and says so before signing).

### Publishing ready-made actions (team, before launch)

After `script/DeployTrader.s.sol`, run `node tools/presets.mjs 4663` (writes `config/agent-presets.4663.json` from the deployed NeonTrader) and `node tools/export-web.mjs 4663`. For any other action, copy the format from `config/agent-presets.example.json` and list only **verified** contracts. Rules:
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
effectiveLockedUntil() returns (uint64)                            // its own lock or the lock of the Face it sits in
holder() returns (address)                                          // who the agent answers to
```

Find the account of a Face with `NeonSeeder.accountOf(tokenId)`.

Trading by ticker: [`tools/agent-trade.mjs`](../tools/agent-trade.mjs) routes through USDG when needed, shows the Chainlink minimum and the day's remaining cap, then executes through NeonTrader.

```bash
AGENT_PK=<delegated key> node tools/agent-trade.mjs 4663 42 USDG TSLA 50     # buy TSLA with 50 USDG
AGENT_PK=<delegated key> node tools/agent-trade.mjs 4663 42 ETH SPY 0.005     # ETH budget applies
```

Generic reference loop for any other allowed call: [`tools/agent-example.mjs`](../tools/agent-example.mjs) — locate the account, check `agentConfig().active`, the lock, `isAgentCallAllowed` and the budget, simulate, send.

## Errors

| Error | Meaning |
|---|---|
| `AgentNotActive()` | caller isn't the agent, delegation expired / revoked, or the Face changed hands |
| `AgentCallNotAllowed(target, selector)` | that function on that contract isn't allowed |
| `AgentValueExceeded(requested, remaining)` | ETH budget too low |
| `AccountIsLocked(until)` | the holder locked the account |
| `InvalidAgentConfig()` | zero / self agent, past expiry, account as target |
| `DailyLimitExceeded(requested, left)` | NeonTrader: over the holder's daily USD cap |
| `StalePrice(token, updatedAt)` | NeonTrader: Chainlink price older than 26 h (market closed) |
| `SlippageTooHigh()` | NeonTrader: more than 1% requested |
| `RouteTooExpensive()` | NeonTrader: the pools on the path charge more than 1% in total |
