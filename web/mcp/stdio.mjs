// The kit's Node entry: MCP over stdio (newline-delimited JSON-RPC), for clients that run a local command.
// env (optional): NEONFACES_SITE (default https://neonfaces.xyz/), RPC_URL (one node to use instead of the site's list)
import { createInterface } from "node:readline";
import { createServer } from "./core.mjs";

const server = createServer({
  site: process.env.NEONFACES_SITE || "https://neonfaces.xyz/",
  rpc: process.env.RPC_URL ? () => [process.env.RPC_URL] : undefined,
});
const send = (m) => process.stdout.write(JSON.stringify(m) + "\n");
createInterface({ input: process.stdin }).on("line", async (line) => {
  let m;
  try {
    m = JSON.parse(line);
  } catch {
    return;
  }
  const r = await server.handle(m);
  if (r) send(r);
});
