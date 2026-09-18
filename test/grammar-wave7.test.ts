import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCorpus } from "../src/corpus/loader.js";
import { runFlavor } from "../src/conformance/runner.js";
import { PendingRegistry } from "../src/conformance/pending.js";
import { grammarImplementation } from "../src/flavors/index.js";

// Grammar wave 7: ansi — full port of the Ruby flavor, gated through
// the same conformance checks as corpus mode.

const TESTSUITE_DIR =
  process.env["TESTSUITE_DIR"] ?? "../pubid-testsuite/tests";

test("every ansi corpus case passes through the grammar", () => {
  const corpus = loadCorpus(TESTSUITE_DIR);
  const payloads = corpus.flavors.get("ansi")!;
  const impl = grammarImplementation("ansi")!;
  assert.ok(impl, "ansi is grammar-backed");
  const report = runFlavor("ansi", payloads, impl, new PendingRegistry());
  assert.equal(report.failures.length, 0, report.failures.join("; "));
  assert.equal(report.outcome, "pass");
  assert.equal(report.cases, payloads.cases.length);
  assert.ok(report.cases > 0);
});

test("ansi parses open-ended beyond the corpus", () => {
  const impl = grammarImplementation("ansi")!;
  // "Std" is consumed and dropped from every representation.
  assert.equal(impl.parse("ANSI Std X12.5-1994").toHuman(), "ANSI X12.5-1994");
  // Copublishers + part + year combine in the URN namespace.
  assert.equal(impl.parse("ANSI/IEC 60601-1:2007").toUrn(),
    "urn:ansi-iec:60601:-1:2007");
  // Languages round-trip.
  assert.equal(impl.parse("ANSI X3.4(en,fr)").toUrn(), "urn:ansi:X3.4:en,fr");
  assert.equal(impl.parse("ANSI X3.4(en,fr)").toHuman(), "ANSI X3.4(en,fr)");
  // Lowercase letter suffix on a digits form.
  assert.equal(impl.parse("ANSI 802.1b-1995").toHash().part, "1995");
  // Multi-dot letter-prefix forms.
  assert.equal(impl.parse("ANSI C57.12.10-1988").toHuman(),
    "ANSI C57.12.10-1988");
});

test("ansi rejects non-identifiers", () => {
  const impl = grammarImplementation("ansi")!;
  assert.throws(() => impl.parse("ANSI"));
  assert.throws(() => impl.parse("ANSI/ 802.3"));
  assert.throws(() => impl.parse("ANSI X3.4:20"));
  assert.throws(() => impl.parse("ISO 9899"));
  assert.throws(() => impl.parse("ANSI/XX 802.3"));
});
