import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCorpus } from "../src/corpus/loader.js";
import { checkCase, runFlavor } from "../src/conformance/runner.js";
import { PendingRegistry } from "../src/conformance/pending.js";
import { oimlGrammarImplementation } from "../src/flavors/oiml/implementation.js";
import { grammarImplementation } from "../src/flavors/index.js";
import { parseGrammar } from "../src/grammar/engine.js";
import { oimlGrammar } from "../src/flavors/oiml/grammar.js";

// Grammar wave 1: the OIML parslet grammar ported 1:1 from
// lib/pubid/oiml/parser.rb, run against the full OIML corpus slice
// through the SAME conformance checks corpus mode uses. This is the
// parity floor: a wave can never regress below what corpus mode
// resolved.

const TESTSUITE_DIR =
  process.env["TESTSUITE_DIR"] ?? "../pubid-testsuite/tests";

test("the grammar registry serves oiml", () => {
  assert.ok(grammarImplementation("oiml"));
});

test("open-ended parsing: a real-world OIML identifier absent from the corpus parses", () => {
  // Issue #1's headline rejection: a published Recommendation the corpus
  // does not carry. The grammar does not need the corpus.
  const id = grammarImplementation("oiml")!.parse("OIML R 60-1:2021");
  assert.equal(id.toHuman(), "OIML R 60-1:2021");
  assert.equal(id.toUrn(), "urn:oiml:r:60-1:2021");
  assert.deepEqual(id.toHash(), {
    _type: "pubid:oiml:recommendation",
    publisher: "OIML",
    number: "60",
    part: "1",
    year: "2021",
  });
});

test("every OIML corpus case passes through the grammar", () => {
  const corpus = loadCorpus(TESTSUITE_DIR);
  const payloads = corpus.flavors.get("oiml")!;
  const impl = oimlGrammarImplementation();
  const pending = new PendingRegistry();
  const report = runFlavor("oiml", payloads, impl, pending);
  assert.equal(report.failures.length, 0);
  assert.equal(report.outcome, "pass");
  // Parity is relative to whatever the PINNED corpus carries (the pin
  // lags the testsuite default branch between bumps) - the grammar must
  // pass every case it is given, not a magic count.
  assert.equal(report.cases, payloads.cases.length);
  assert.ok(report.cases > 0, "the oiml corpus slice is non-empty");
});

test("the grammar rejects non-identifiers (parse, never nil)", () => {
  assert.throws(() => parseGrammar(oimlGrammar, "not an oiml identifier"));
  assert.throws(() => parseGrammar(oimlGrammar, "ISO 8601:2004"));
});
