import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCorpus } from "../src/corpus/loader.js";
import { runFlavor } from "../src/conformance/runner.js";
import { PendingRegistry } from "../src/conformance/pending.js";
import { grammarImplementation } from "../src/flavors/index.js";

// Grammar wave 5: isbn, easc — full ports of the Ruby flavors, gated
// through the same conformance checks as corpus mode.

const TESTSUITE_DIR =
  process.env["TESTSUITE_DIR"] ?? "../pubid-testsuite/tests";

const WAVE = ["isbn", "easc"] as const;

for (const flavor of WAVE) {
  test(`every ${flavor} corpus case passes through the grammar`, () => {
    const corpus = loadCorpus(TESTSUITE_DIR);
    const payloads = corpus.flavors.get(flavor)!;
    const impl = grammarImplementation(flavor)!;
    assert.ok(impl, `${flavor} is grammar-backed`);
    const report = runFlavor(flavor, payloads, impl, new PendingRegistry());
    assert.equal(report.failures.length, 0, report.failures.join("; "));
    assert.equal(report.outcome, "pass");
    assert.equal(report.cases, payloads.cases.length);
    assert.ok(report.cases > 0);
  });
}

test("isbn parses open-ended beyond the corpus", () => {
  const impl = grammarImplementation("isbn")!;
  // ISBN-10 with an X check digit, plus prefix spellings the corpus lacks.
  assert.equal(impl.parse("080442957X").toHuman(), "ISBN 080442957X");
  assert.equal(impl.parse("ISBN:0-8044-2957-X").toUrn(), "urn:isbn");
  assert.equal(impl.parse("ISBN 978-0-306-40615-7").toHuman(),
    "ISBN 978-0-306-40615-7");
  // Hyphenation is preserved verbatim for round-trip.
  assert.deepEqual(impl.parse("ISBN 978-0-306-40615-7").toHash(), {
    _type: "pubid:isbn:book",
    raw: "9780306406157",
    hyphenated: "978-0-306-40615-7",
  });
});

test("isbn rejects invalid bodies", () => {
  const impl = grammarImplementation("isbn")!;
  // Valid length, wrong check digit.
  assert.throws(() => impl.parse("ISBN 978-3-16-148410-2"));
  assert.throws(() => impl.parse("ISBN 0306406153"));
  // Wrong lengths.
  assert.throws(() => impl.parse("ISBN 123456789"));
  assert.throws(() => impl.parse("ISBN 12345678901234"));
  // X outside the check-digit position.
  assert.throws(() => impl.parse("ISBN X306406152"));
});

test("easc parses open-ended beyond the corpus", () => {
  const impl = grammarImplementation("easc")!;
  // Latin transliterations normalize to the Cyrillic canonical human form.
  assert.equal(impl.parse("PMG 03-2025").toHuman(), "ПМГ 03-2025");
  assert.equal(impl.parse("RMG V 31—2001").toHuman(), "РМГ В 31-2001");
  // Em-dash and spaced separators; dotted numbers.
  assert.equal(impl.parse("ПМГ 03 — 2025").toHuman(), "ПМГ 03-2025");
  assert.equal(impl.parse("РМГ 29.1-2013").toUrn(), "urn:easc:rmg:29.1:2013");
  assert.equal(impl.parse("РМГ 29.1–2013").toUrn(), "urn:easc:rmg:29.1:2013");
});

test("easc rejects non-identifiers", () => {
  const impl = grammarImplementation("easc")!;
  assert.throws(() => impl.parse("ПМГ"));
  assert.throws(() => impl.parse("ПМГ 03-"));
  assert.throws(() => impl.parse("АМГ 03-2025"));
});
