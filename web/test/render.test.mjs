// The site's JS renderer must match the contract byte for byte (same fixtures as the Solidity test).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderSVG } from "../src/render.js";

const fixtures = JSON.parse(readFileSync(new URL("../../contracts/test/fixtures/svg-samples.json", import.meta.url)));

for (const f of fixtures) {
  test(`art ${f.artId} renders byte-identical to NeonRenderer`, () => {
    assert.equal(renderSVG(f.artId, f.record), f.svg);
  });
}
