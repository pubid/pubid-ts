//! T1 + T3 conformance: the wasm artifact runtime parses, binds and
//! materializes against the Ruby-generated artifacts, and the external
//! *.pgtest suites run green through the same engine.
//!
//! The artifacts live in the pubid-grammar sibling checkout, which CI
//! does not check out; without it these integration tests skip.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { PubidRuntime } from "../src/parg/runtime.js";
import { loadCorpus } from "../src/corpus/loader.js";
import { loadSuites, runSuite, suitesDir } from "../src/parg/suite.js";

const skipReason = existsSync(join(PubidRuntime.artifactsDir(), "iso.json"))
  ? false
  : "pubid-grammar artifacts not available (PARG_ARTIFACT_DIR unset, sibling checkout absent)";

test(
  "iso artifact loads with verified checksum and exposes entries",
  { skip: skipReason },
  () => {
    const runtime = PubidRuntime.load("iso");
    assert.deepEqual(runtime.artifact.entryNames(), ["identifier", "idf.identifier"]);
  },
);

test(
  "schema-driven materialization produces typed attributes (T1)",
  { skip: skipReason },
  () => {
    const runtime = PubidRuntime.load("iso");
    const materialized = runtime.materialize("ISO 5537:2025");
    assert.ok(materialized, "ISO 5537:2025 must parse");
    assert.equal(materialized.entry, "identifier");
    const schema = runtime.schema["identifier"];
    assert.ok(schema, "identifier entry must have a schema");
    // A single sample input exercises only the branches it spells, so the
    // per-attribute coverage contract moved to the corpus-wide test below
    // (with 83 schema fields, one input cannot carry them all). What stays
    // pinned here is the typed identity of the sample itself.
    assert.equal(materialized.attributes["publisher"], "ISO");
    assert.equal(
      materialized.attributes["publisher_name"],
      "International Organization for Standardization",
    );
  },
);

test(
  "every identifier schema field materializes somewhere in the corpus (T1 coverage)",
  {
    skip: process.env["TESTSUITE_DIR"]
      ? skipReason
      : "TESTSUITE_DIR not set (the pubid-ts CI checks the testsuite out; the grammar CI's TS gate runs without it)",
  },
  () => {
    const runtime = PubidRuntime.load("iso");
    const schema = runtime.schema["identifier"];
    assert.ok(schema, "identifier entry must have a schema");
    const schemaFields = Object.keys(schema.fields);
    const corpus = loadCorpus(process.env["TESTSUITE_DIR"]!);
    const payloads = corpus.flavors.get("iso");
    assert.ok(payloads, "the corpus must carry an iso flavor");
    const uncovered = new Set(schemaFields);
    for (const testCase of payloads.cases) {
      if (uncovered.size === 0) break;
      let bound;
      try {
        bound = runtime.materialize(testCase.representations.human);
      } catch {
        continue;
      }
      if (!bound) continue;
      for (const leaf of Object.keys(bound.attributes)) uncovered.delete(leaf);
    }
    assert.deepEqual(
      [...uncovered].sort(),
      [],
      "schema fields no corpus case materializes (schema/grammar drift)",
    );
  },
);

test("embedded tests run green through the wasm engine (T3)", { skip: skipReason }, () => {
  const runtime = PubidRuntime.load("iso");
  assert.deepEqual(runtime.runTests(), []);
});

test("external *.pgtest suites run green through wasm (T3)", { skip: skipReason }, () => {
  const runtime = PubidRuntime.load("iso", "identifier");
  const suites = loadSuites(suitesDir());
  assert.ok(suites.length >= 1, "at least one suite file expected");
  for (const suite of suites) {
    const failures = runSuite(runtime, suite);
    assert.deepEqual(failures, [], `suite ${suite.name} must be green`);
  }
});

test("reject inputs are rejected by the wasm engine", { skip: skipReason }, () => {
  const runtime = PubidRuntime.load("iso");
  assert.equal(runtime.parseAndBind("nonsense"), null);
});

test("derived URN matches the Ruby reference (F6 derive)", { skip: skipReason }, () => {
  const runtime = PubidRuntime.load("iso");
  assert.equal(runtime.deriveString("ISO 5537:2025", "urn"), "urn:iso:std:5537:2025");
});
