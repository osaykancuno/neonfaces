// The MCP kit: its bundled What I see is the site's own (scripts/bundle-mcp.mjs --check), and it answers an MCP client
// with its tools (no network needed for these two).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const at = (p) => fileURLToPath(new URL(`../${p}`, import.meta.url));

test("the kit carries the current analysis.js and guard.js", () => {
  execFileSync(process.execPath, [at("scripts/bundle-mcp.mjs"), "--check"], { stdio: "pipe" });
});

test("the kit answers initialize and tools/list over stdio", async () => {
  const p = spawn(process.execPath, [at("public/neonfaces-mcp.mjs")], { stdio: ["pipe", "pipe", "pipe"] });
  const lines = [];
  let buf = "";
  const got = new Promise((done) =>
    p.stdout.on("data", (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        lines.push(JSON.parse(buf.slice(0, i)));
        buf = buf.slice(i + 1);
        if (lines.length === 2) done();
      }
    }),
  );
  p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } }) + "\n");
  p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }) + "\n");
  await got;
  p.kill();
  assert.equal(lines[0].result.serverInfo.name, "neonfaces");
  assert.match(lines[0].result.instructions, /never as a recommendation or a forecast/);
  const names = lines[1].result.tools.map((t) => t.name);
  for (const n of ["face", "analysis", "market", "check", "prices", "faces_of", "prepare_action"]) assert.ok(names.includes(n), n);
});
