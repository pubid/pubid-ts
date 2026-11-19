#!/usr/bin/env node
// Compresses the eu+arxiv parity fixture into the committed npm-test
// artifact test/fixtures/eu-arxiv-parity.json.gz (the gen-pubid-urn-parity
// convention: node zlib level 9). Paths resolve from THIS script's
// location, never the caller's cwd.
//
//   node scripts/gen-eu-arxiv-parity.mjs /tmp/eu-arxiv-parity.json
//
// The input is scripts/eu-arxiv-parity-ruby-probe.rb's output.
import { readFileSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const inPath = resolve(process.argv[2] ?? "/tmp/eu-arxiv-parity.json");
const out = join(repoRoot, "test", "fixtures", "eu-arxiv-parity.json.gz");

const raw = readFileSync(inPath, "utf8");
const doc = JSON.parse(raw);
const total = doc.eu.pass.length + doc.eu.fail.length + doc.eu.sweep.length +
  doc.eu.matches.length + doc.arxiv.pass.length + doc.arxiv.fail.length +
  doc.arxiv.matches.length;
writeFileSync(out, gzipSync(Buffer.from(raw, "utf8"), { level: 9 }));
console.log(
  `fixture: eu ${doc.eu.pass.length} pass + ${doc.eu.fail.length} fail + ` +
    `${doc.eu.sweep.length} sweep + ${doc.eu.matches.length} matches, ` +
    `arxiv ${doc.arxiv.pass.length} pass + ${doc.arxiv.fail.length} fail + ` +
    `${doc.arxiv.matches.length} matches (${total} rows, ` +
    `${(raw.length / 1e3).toFixed(0)} KB raw) -> ${out}`,
);
