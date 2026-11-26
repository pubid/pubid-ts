#!/usr/bin/env node
// Compresses the bsi_pfs parity fixture into the committed npm-test
// artifact test/fixtures/bsi-pfs-parity.json.gz (the gen-cen-pfs-parity
// convention: node zlib level 9; the 843-row absorbed inventory, the
// 657-row unabsorbed ledger, the faces, the negatives and the boundary
// rows gzip well). Paths resolve from THIS script's location, never the
// caller's cwd.
//
//   node scripts/gen-bsi-pfs-parity.mjs /tmp/bsi-pfs-parity.json
//
// The input is scripts/bsi-pfs-parity-ruby-probe.rb's output.
import { readFileSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const inPath = resolve(process.argv[2] ?? "/tmp/bsi-pfs-parity.json");
const out = join(repoRoot, "test", "fixtures", "bsi-pfs-parity.json.gz");

const raw = readFileSync(inPath, "utf8");
const rows = JSON.parse(raw);
const total =
  rows.inventory.length + rows.ledger.length + rows.faces.length +
  rows.negatives.length + rows.boundary.length;
writeFileSync(out, gzipSync(Buffer.from(raw, "utf8"), { level: 9 }));
console.log(
  `fixture: ${rows.inventory.length} absorbed + ${rows.ledger.length} ledger + ` +
    `${rows.faces.length} faces + ${rows.negatives.length} negatives + ` +
    `${rows.boundary.length} boundary (${total} rows, ` +
    `${(raw.length / 1e3).toFixed(0)} KB raw) -> ${out}`,
);
