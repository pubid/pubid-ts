#!/usr/bin/env node
// Cross-engine conformance gate (TODO.SOTA/04).
//
// Every F4 corpus case in the grammar checkout records the tree the
// NATIVE engine produced (corpora/<flavor>/corpus.json). This gate
// parses each case through the WASM engine and requires the same tree,
// row for row, so an engine drift fails with the flavor, case index and
// input named. It also verifies every artifact's freshness envelope:
// source_hash + compiler_version must be present, and when the grammar
// sources are available the artifact must have been compiled from its
// current .parg.
//
//   PARG_ARTIFACT_DIR=../pubid-grammar/artifacts \
//   PARG_CORPORA_DIR=../pubid-grammar/corpora \
//   PARG_GRAMMAR_DIR=../pubid-grammar/grammars \
//     node scripts/corpus-parity.mjs
//
// The corpus check runs when PARG_CORPORA_DIR exists; the freshness
// source comparison runs when PARG_GRAMMAR_DIR exists. Exit code 1 on
// any drift, so the grammar workflow can gate a merge on it.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { PargRuntime } from "parsanol";

const artifactsDir = resolve(process.env["PARG_ARTIFACT_DIR"] ?? "../pubid-grammar/artifacts");
const corporaDir = resolve(process.env["PARG_CORPORA_DIR"] ?? "../pubid-grammar/corpora");
const grammarDir = resolve(process.env["PARG_GRAMMAR_DIR"] ?? "../pubid-grammar/grammars");

// Ruby's JSON.generate preserves insertion order; JS objects do not.
// Compare canonicalized trees so key order is not a drift signal.
const canon = (node) => {
  if (Array.isArray(node)) return node.map(canon);
  if (node !== null && typeof node === "object") {
    const out = {};
    for (const key of Object.keys(node).sort()) out[key] = canon(node[key]);
    return out;
  }
  return node;
};
const same = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));
const brief = (value) => JSON.stringify(canon(value)).slice(0, 240);

const artifactFiles = readdirSync(artifactsDir)
  .filter((file) => file.endsWith(".json"))
  .sort();

let fresh = 0;
let unverifiable = 0;
let stale = 0;
const rows = [];

for (const file of artifactFiles) {
  const flavor = file.replace(/\.json$/, "");
  const runtime = PargRuntime.fromFile(join(artifactsDir, file));

  if (!runtime.sourceHash || !runtime.compilerVersion) {
    unverifiable += 1;
    rows.push(`${flavor}: artifact lacks the freshness envelope (source_hash/compiler_version)`);
  } else {
    const sourcePath = join(grammarDir, `${flavor}.parg`);
    if (existsSync(sourcePath) && !runtime.compiledFrom(readFileSync(sourcePath, "utf8"))) {
      stale += 1;
      rows.push(`${flavor}: artifact is STALE against ${sourcePath} — rebake the artifact`);
    } else {
      fresh += 1;
    }
  }
}

let corpusOk = 0;
let corpusDiff = 0;
let corpusThrew = 0;
let corpusBadReject = 0;
let boundOk = 0;
let boundDiff = 0;
let boundThrew = 0;

if (existsSync(corporaDir)) {
  for (const flavor of readdirSync(corporaDir).sort()) {
    const corpusPath = join(corporaDir, flavor, "corpus.json");
    if (!existsSync(corpusPath)) continue;

    const artifactPath = join(artifactsDir, `${flavor}.json`);
    if (!existsSync(artifactPath)) {
      corpusDiff += 1;
      rows.push(`${flavor}: corpus exists but artifacts/${flavor}.json does not`);
      continue;
    }
    const runtime = PargRuntime.fromFile(artifactPath);
    const corpus = JSON.parse(readFileSync(corpusPath, "utf8"));

    for (const [index, testCase] of corpus.cases.entries()) {
      const input = testCase.input;
      if (testCase.kind === "reject") {
        let accepted = false;
        try {
          accepted = runtime.parseShape(input) !== null;
        } catch {
          accepted = false;
        }
        if (accepted) {
          corpusBadReject += 1;
          rows.push(`${flavor}#${index}: wasm ACCEPTED a reject case ${JSON.stringify(input)}`);
        } else {
          corpusOk += 1;
        }
        continue;
      }

      let got;
      try {
        got = runtime.parseShape(input);
      } catch (error) {
        corpusThrew += 1;
        rows.push(
          `${flavor}#${index}: wasm THREW on ${JSON.stringify(input)}: ` +
            `${(error instanceof Error ? error.message : String(error)).slice(0, 120)}`,
        );
        continue;
      }
      if (same(got, testCase.parsanol_tree)) {
        corpusOk += 1;
      } else {
        corpusDiff += 1;
        rows.push(
          `${flavor}#${index}: wasm tree DIFFERS on ${JSON.stringify(input)}\n` +
            `    want ${brief(testCase.parsanol_tree)}\n` +
            `    got  ${brief(got)}`,
        );
      }

      // ruby#308 B2 parity clause: the BOUND tree too. The corpus
      // records what Ruby's binding application produced (casts
      // included); the wasm engine must produce the same attribute
      // hash or the five-runtime bound-tree agreement is prose.
      const expectedBound = testCase.bound;
      if (expectedBound && Object.keys(expectedBound).length > 0) {
        let bound;
        try {
          bound = runtime.parseAndBind(input);
        } catch (error) {
          boundThrew += 1;
          rows.push(
            `${flavor}#${index}: wasm parseAndBind THREW on ${JSON.stringify(input)}: ` +
              `${(error instanceof Error ? error.message : String(error)).slice(0, 120)}`,
          );
          continue;
        }
        if (same(bound, expectedBound)) {
          boundOk += 1;
        } else {
          boundDiff += 1;
          rows.push(
            `${flavor}#${index}: wasm bound tree DIFFERS on ${JSON.stringify(input)}\n` +
              `    want ${brief(expectedBound)}\n` +
              `    got  ${brief(bound)}`,
          );
        }
      }
    }
  }
}

if (rows.length > 0) {
  console.error(rows.join("\n"));
  console.error("");
}
console.log(
  `freshness: ${fresh} fresh, ${stale} stale, ${unverifiable} unverifiable; ` +
    `corpus: ${corpusOk} agree, ${corpusDiff} differ, ${corpusThrew} threw, ` +
    `${corpusBadReject} reject-accepted; ` +
    `bound: ${boundOk} agree, ${boundDiff} differ, ${boundThrew} threw`,
);
if (rows.length > 0) {
  console.error("cross-engine parity: RED");
  process.exit(1);
}
console.log("cross-engine parity: GREEN");
