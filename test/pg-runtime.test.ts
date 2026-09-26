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
import { PgRuntime } from "../src/pg/runtime.js";
import { loadSuites, runSuite, suitesDir } from "../src/pg/suite.js";

const skipReason = existsSync(join(PgRuntime.artifactsDir(), "iso.json"))
  ? false
  : "pubid-grammar artifacts not available (PG_ARTIFACT_DIR unset, sibling checkout absent)";

test(
  "iso artifact loads with verified checksum and exposes entries",
  { skip: skipReason },
  () => {
    const runtime = PgRuntime.load("iso");
    assert.deepEqual(runtime.artifact.entryNames(), ["identifier", "idf.identifier"]);
  },
);

test(
  "schema-driven materialization produces typed attributes (T1)",
  { skip: skipReason },
  () => {
    const runtime = PgRuntime.load("iso");
    const materialized = runtime.materialize("ISO 5537:2025");
    assert.ok(materialized, "ISO 5537:2025 must parse");
    assert.equal(materialized.entry, "identifier");
    const schema = runtime.schema["identifier"];
    assert.ok(schema, "identifier entry must have a schema");
    for (const path of Object.keys(schema.fields)) {
      const leaf = path.includes("[]") ? (path.split("].").pop() ?? path) : path;
      assert.ok(leaf in materialized.attributes, `materialized lacks ${leaf}`);
    }
    assert.equal(materialized.attributes["publisher"], "ISO");
    assert.equal(
      materialized.attributes["publisher_name"],
      "International Organization for Standardization",
    );
  },
);

test("embedded tests run green through the wasm engine (T3)", { skip: skipReason }, () => {
  const runtime = PgRuntime.load("iso");
  assert.deepEqual(runtime.runTests(), []);
});

test("external *.pgtest suites run green through wasm (T3)", { skip: skipReason }, () => {
  const runtime = PgRuntime.load("iso", "identifier");
  const suites = loadSuites(suitesDir());
  assert.ok(suites.length >= 1, "at least one suite file expected");
  for (const suite of suites) {
    const failures = runSuite(runtime, suite);
    assert.deepEqual(failures, [], `suite ${suite.name} must be green`);
  }
});

test("reject inputs are rejected by the wasm engine", { skip: skipReason }, () => {
  const runtime = PgRuntime.load("iso");
  assert.equal(runtime.parseAndBind("nonsense"), null);
});

test("derived URN matches the Ruby reference (F6 derive)", () => {
  const runtime = PgRuntime.load("iso");
  assert.equal(runtime.deriveString("ISO 5537:2025", "urn"), "urn:iso:std:5537:2025");
});
