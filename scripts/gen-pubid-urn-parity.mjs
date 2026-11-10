#!/usr/bin/env node
// Merges the ruby parity probe output into the committed npm-test
// fixture test/fixtures/pubid-urn-parity.json.gz (pubid-ts#161).
//
//   PARITY_JSON=/tmp/urn-ref/parity-pin.json \
//   TESTSUITE_DIR=/tmp/tsuite-pin/tests \
//   RUBY_HASHES=/tmp/urn-ref/ruby-hashes.json \
//     node scripts/gen-pubid-urn-parity.mjs
//
// - PARITY_JSON   scripts/pubid-urn-ruby-probe.rb's output (URNs per row)
// - TESTSUITE_DIR the SAME tests tree the probe ran over
// - RUBY_HASHES   the psych-loaded hashes for that tree (the probe
//   script's sibling output; only divergent rows are embedded)
//
// The fixture carries one entry per row: flavor -> { id -> urn }. Rows
// whose psych hash differs from what the npm `yaml` package loads (the
// YAML 1.1 vs 1.2 float schema divergence — see RUBY_HASHES) embed the
// ruby hash under `hashOverrides`, because the codec contract is
// "identical given the same hash" and the ruby hash is the reference
// wire form.
import { writeFileSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";

const parityPath = resolve(process.env["PARITY_JSON"] ?? "/tmp/urn-ref/parity-pin.json");
const testsDir = resolve(process.env["TESTSUITE_DIR"] ?? "../pubid-testsuite/tests");
const rubyHashesPath = process.env["RUBY_HASHES"];
const out = resolve("test/fixtures/pubid-urn-parity.json.gz");

const parity = JSON.parse(readFileSync(parityPath, "utf8"));
const urns = {};
const idsByRow = new Set();
for (const [flavor, payload] of Object.entries(parity)) {
  urns[flavor] = {};
  for (const row of payload.rows) {
    if (row.urn === undefined) {
      throw new Error(`${flavor} ${row.id}: the ruby probe failed to emit (${row.urn_error})`);
    }
    urns[flavor][row.id] = row.urn;
    idsByRow.add(row.id);
  }
}

// The psych-vs-yaml-package divergence: every row whose ruby-loaded
// hash differs from the npm-yaml-loaded one carries its ruby hash in
// the fixture, and the gates use it in place of the artifact's.
const canon = (node) => {
  if (Array.isArray(node)) return node.map(canon);
  if (node !== null && typeof node === "object") {
    const out = {};
    for (const key of Object.keys(node).sort()) out[key] = canon(node[key]);
    return out;
  }
  return node;
};
const jsHash = new Map();
for (const entry of readdirSync(testsDir).sort()) {
  const dir = join(testsDir, entry);
  if (!statSync(dir).isDirectory()) continue;
  for (const file of readdirSync(dir).sort()) {
    if (!file.endsWith(".yaml") || file.startsWith("_")) continue;
    const doc = parseYaml(readFileSync(join(dir, file), "utf8"));
    if (!Array.isArray(doc)) continue;
    for (const row of doc) {
      if (row.identifier !== undefined && row.identifier !== null) {
        jsHash.set(row.id, row.identifier);
      }
    }
  }
}

const rubyHashes = rubyHashesPath
  ? JSON.parse(readFileSync(rubyHashesPath, "utf8"))
  : jsHash;
const hashOverrides = {};
let overridden = 0;
for (const [id, rubyHash] of Object.entries(rubyHashes)) {
  const js = jsHash.get(id);
  if (js === undefined) continue;
  if (JSON.stringify(canon(rubyHash)) !== JSON.stringify(canon(js))) {
    hashOverrides[id] = rubyHash;
    overridden += 1;
  }
}

const fixture = {
  generatedFrom: {
    note: "regenerate with scripts/pubid-urn-ruby-probe.rb + scripts/gen-pubid-urn-parity.mjs when the testsuite or pubid pins move",
  },
  urns,
  hashOverrides,
};

mkdirSync("test/fixtures", { recursive: true });
writeFileSync(out, gzipSync(Buffer.from(JSON.stringify(fixture), "utf8"), { level: 9 }));
console.log(
  `fixture: ${Object.keys(urns).length} flavors, ` +
    `${Object.values(urns).reduce((s, f) => s + Object.keys(f).length, 0)} URNs, ` +
    `${overridden} hash overrides -> ${out}`,
);
