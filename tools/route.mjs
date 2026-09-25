// Uniswap v3 routes between the tokens listed in config/trader.<chainId>.json.
// Every token trades against its hub: USDG by default, or the token named in its "hub" field when its deepest
// pool is elsewhere (cbBTC trades against WETH). WETH itself trades against USDG. "fee" is the pool fee between
// a token and its hub. The route is the shortest walk through the hubs: ETH -> cbBTC is one hop, USDG -> cbBTC
// goes through WETH, TSLA -> GLD goes through USDG. The same rule lives in web/src/actions.js.

/** { path: address[], fees: number[] } from token `from` to token `to` (objects of the trader config). */
export function route(tokens, from, to) {
  const bySym = Object.fromEntries(tokens.map((t) => [t.symbol, t]));
  const hub = (t) => (t.symbol === "USDG" ? null : bySym[t.hub ?? "USDG"]);
  const chain = (t) => (hub(t) ? [t, ...chain(hub(t))] : [t]);
  const a = chain(from);
  const b = chain(to);
  let nodes;
  for (let i = 0; i < a.length && !nodes; i++) {
    const j = b.findIndex((t) => t.symbol === a[i].symbol);
    if (j >= 0) nodes = [...a.slice(0, i + 1), ...b.slice(0, j).reverse()];
  }
  const fees = nodes.slice(1).map((y, k) => (hub(nodes[k])?.symbol === y.symbol ? nodes[k].fee : y.fee));
  return { path: nodes.map((t) => t.address), fees };
}
