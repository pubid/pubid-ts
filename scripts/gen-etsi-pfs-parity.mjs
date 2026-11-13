#!/usr/bin/env node
// Compresses the etsi_pfs parity fixture into the committed npm-test
// artifact test/fixtures/etsi-pfs-parity.json.gz (the gen-pubid-urn-parity
// convention: node zlib level 9; the 24,718-row inventory is far too
// large to commit as pretty JSON). Paths resolve from THIS script's
// location, never the caller's cwd.
//
//   node scripts/gen-etsi-pfs-parity.mjs /tmp/etsi-pfs-parity.json
//
// The input is scripts/etsi-pfs-parity-ruby-probe.rb's output.
import { readFileSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const inPath = resolve(process.argv[2] ?? "/tmp/etsi-pfs-parity.json");
const out = join(repoRoot, "test", "fixtures", "etsi-pfs-parity.json.gz");

const raw = readFileSync(inPath, "utf8");
const rows = JSON.parse(raw);
const total = rows.inventory.length + rows.faces.length + rows.negatives.length;
writeFileSync(out, gzipSync(Buffer.from(raw, "utf8"), { level: 9 }));
console.log(
  `fixture: ${rows.inventory.length} inventory + ${rows.faces.length} faces + ` +
    `${rows.negatives.length} negatives (${total} rows, ` +
    `${(raw.length / 1e6).toFixed(1)} MB raw) -> ${out}`,
);
