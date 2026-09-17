#!/usr/bin/env node
// Regenerates the bundled corpus artifact (artifact/corpus.json.gz) from
// a pubid-testsuite checkout. Run via `npm run artifact` with
// TESTSUITE_DIR pointing at the checkout's tests/ directory (default
// ../pubid-testsuite/tests). Commit the result and bump TESTSUITE_REF in
// ci.yml in the same change - the artifact must match the pinned corpus.
import { writeFileSync, mkdirSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { loadCorpus } from "../dist/corpus/loader.js";
import { buildArtifact } from "../dist/corpus/artifact.js";

const testsDir = process.env["TESTSUITE_DIR"] ?? "../pubid-testsuite/tests";
const corpus = loadCorpus(testsDir);
const json = buildArtifact(corpus);
const gz = gzipSync(Buffer.from(json, "utf8"), { level: 9 });

mkdirSync("artifact", { recursive: true });
writeFileSync("artifact/corpus.json.gz", gz);

const cases = [...corpus.flavors.values()]
  .reduce((sum, p) => sum + p.cases.length, 0);
console.log(
  `artifact: ${corpus.flavors.size} flavors, ${cases} cases, ` +
  `${(json.length / 1048576).toFixed(1)} MB json -> ${(gz.length / 1048576).toFixed(1)} MB gz`,
);
