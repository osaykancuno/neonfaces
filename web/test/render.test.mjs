// The site's JS renderer must match the contract byte for byte (same fixtures as the Solidity test).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderSVG, renderSetSVG } from "../src/render.js";

const fixtures = JSON.parse(readFileSync(new URL("../../contracts/test/fixtures/svg-samples.json", import.meta.url)));

for (const f of fixtures) {
  test(`art ${f.artId} renders byte-identical to NeonRenderer`, () => {
    assert.equal(renderSVG(f.artId, f.record), f.svg);
  });
}

const set = JSON.parse(readFileSync(new URL("../../contracts/test/fixtures/svg-set-sample.json", import.meta.url)));
test(`assembled set ${set.set} renders byte-identical to NeonRenderer`, () => {
  assert.equal(renderSetSVG(set.set, set.records), set.svg);
  for (const g of [1, 2, 3]) assert.equal(renderSetSVG(set.set, set.records, g), set[`gaze${g}`], `gaze ${g}`);
});
