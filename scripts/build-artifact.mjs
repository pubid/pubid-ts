#!/usr/bin/env node
// Regenerates the bundled corpus artifact (artifact/corpus.json.gz) from
// a pubid-testsuite checkout, and vendors the grammar artifacts
// (vendor/parg/*.json) so the published package's artifact-backed
// flavors load without a pubid-grammar checkout. Run via
// `npm run artifact` with TESTSUITE_DIR pointing at the checkout's
// tests/ directory (default ../pubid-testsuite/tests) and
// PARG_ARTIFACT_DIR at the grammar artifacts (default the sibling
// pubid-grammar). Commit the result and bump TESTSUITE_REF +
// PARG_GRAMMAR_REF in ci.yml and release.yml in the same change - the
// bundles must match the pinned refs.
import { writeFileSync, mkdirSync, readdirSync, copyFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { loadCorpus } from "../dist/corpus/loader.js";
import { buildArtifact } from "../dist/corpus/artifact.js";
import { artifactsDir } from "../dist/parg/runtime.js";

const testsDir = process.env["TESTSUITE_DIR"] ?? "../pubid-testsuite/tests";
const corpus = loadCorpus(testsDir);
const json = buildArtifact(corpus);
const gz = gzipSync(Buffer.from(json, "utf8"), { level: 9 });

mkdirSync("artifact", { recursive: true });
writeFileSync("artifact/corpus.json.gz", gz);

mkdirSync("vendor/parg", { recursive: true });
const artifacts = artifactsDir();
let vendored = 0;
for (const file of readdirSync(artifacts)) {
  if (!file.endsWith(".json")) continue;
  copyFileSync(`${artifacts}/${file}`, `vendor/parg/${file}`);
  vendored += 1;
}

const cases = [...corpus.flavors.values()]
  .reduce((sum, p) => sum + p.cases.length, 0);
console.log(
  `artifact: ${corpus.flavors.size} flavors, ${cases} cases, ` +
  `${(json.length / 1048576).toFixed(1)} MB json -> ${(gz.length / 1048576).toFixed(1)} MB gz; ` +
  `vendored ${vendored} grammar artifacts from ${artifacts}`,
);
