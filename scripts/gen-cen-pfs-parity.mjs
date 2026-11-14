#!/usr/bin/env node
// Compresses the cen_pfs parity fixture into the committed npm-test
// artifact test/fixtures/cen-pfs-parity.json.gz (the gen-pubid-urn-parity
// convention: node zlib level 9; the 189-row inventory plus the faces
// and negatives is small, but the gzip keeps the committed tree in the
// same shape as the etsi_pfs fixture). Paths resolve from THIS script's
// location, never the caller's cwd.
//
//   node scripts/gen-cen-pfs-parity.mjs /tmp/cen-pfs-parity.json
//
// The input is scripts/cen-pfs-parity-ruby-probe.rb's output.
import { readFileSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const inPath = resolve(process.argv[2] ?? "/tmp/cen-pfs-parity.json");
const out = join(repoRoot, "test", "fixtures", "cen-pfs-parity.json.gz");

const raw = readFileSync(inPath, "utf8");
const rows = JSON.parse(raw);
const total = rows.inventory.length + rows.faces.length + rows.negatives.length;
writeFileSync(out, gzipSync(Buffer.from(raw, "utf8"), { level: 9 }));
console.log(
  `fixture: ${rows.inventory.length} inventory + ${rows.faces.length} faces + ` +
    `${rows.negatives.length} negatives (${total} rows, ` +
    `${(raw.length / 1e3).toFixed(0)} KB raw) -> ${out}`,
);
