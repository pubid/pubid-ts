import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCorpus } from "../src/corpus/loader.js";
import { runFlavor } from "../src/conformance/runner.js";
import { PendingRegistry } from "../src/conformance/pending.js";
import { grammarImplementation } from "../src/flavors/index.js";

// Grammar wave 7: ansi, oasis, iho — full ports of the Ruby flavors, gated
// through the same conformance checks as corpus mode.

const TESTSUITE_DIR =
  process.env["TESTSUITE_DIR"] ?? "../pubid-testsuite/tests";

const WAVE = ["ansi", "oasis", "iho"] as const;

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

test("oasis decomposes open-ended slugs beyond the corpus", () => {
  const impl = grammarImplementation("oasis")!;
  // Lowercase "ps01" is not a stage token (case-sensitive as in Ruby),
  // and with no recognized fragment the whole slug is the number.
  assert.deepEqual(impl.parse("OASIS CSDL-ps01").toHash(), {
    _type: "pubid:oasis:standard",
    original: "CSDL-ps01",
    number: "CSDL-ps01",
  });
  // URN echoes the slug verbatim; malformed-record characters encode.
  assert.equal(impl.parse("OASIS x-y-2.0-WD-Pt3-Spec").toUrn(),
    "urn:oasis:x-y-2.0-WD-Pt3-Spec");
  assert.equal(impl.parse("OASIS CTAS-v3.0]-PS01").toUrn(),
    "urn:oasis:CTAS-v3.0%5D-PS01");
  assert.equal(impl.parse("OASIS x-y-2.0-WD-Pt3-Spec").toHuman(),
    "OASIS x-y-2.0-WD-Pt3-Spec");
});

test("oasis rejects non-identifiers", () => {
  const impl = grammarImplementation("oasis")!;
  assert.throws(() => impl.parse("OASIS"));
  assert.throws(() => impl.parse("OASIS "));
  assert.throws(() => impl.parse("oasis amqp-core"));
});

test("iho parses open-ended beyond the corpus", () => {
  const impl = grammarImplementation("iho")!;
  // Prefix-less form parses; renders with the IHO prefix.
  assert.equal(impl.parse("S-44 5.0.0").toHuman(), "IHO S-44 5.0.0");
  // The slash chain is the volume's short face; the edition rides the
  // base and renders ed- in the URN.
  assert.equal(impl.parse("IHO P-1/21 1.0.0").toUrn(),
    "urn:iho:p:1:vol-21:ed-1.0.0");
  assert.equal(impl.parse("IHO P-1/21 1.0.0").toHuman(),
    "IHO P-1 Vol. 21 1.0.0");
  // Colon numbers round-trip unescaped; the edition stays bare dotted
  // in the human face.
  assert.equal(impl.parse("IHO C-16:2 1.0.0").toHuman(), "IHO C-16:2 1.0.0");
  // Component-edition duality: supplement, part, annex and appendix
  // parse in tail order and each carries its own edition.
  assert.equal(
    impl.parse("IHO S-65 2.1.0 Sup 3 Part 4a Annex B Appendix A-2").toUrn(),
    "urn:iho:s:65:ed-2.1.0:sup-3:part-4a:annex-B:appendix-A:2",
  );
  // The volume carries its own edition ("separately-published").
  assert.equal(impl.parse("IHO P-6 Vol. 2 1.0.1").toHuman(),
    "IHO P-6 Vol. 2 1.0.1");
  // "Appendix" is the canonical face; "Ap." input canonicalizes.
  assert.equal(impl.parse("IHO S-53 Ap. 1 1.0.0").toHuman(),
    "IHO S-53 Appendix 1 1.0.0");
  // Legacy aliases bind their canonical components: the glued base
  // becomes a Part, the bare year becomes a Vol.
  assert.equal(impl.parse("IHO S-5A").toHuman(), "IHO S-5 Part A");
  assert.equal(impl.parse("IHO P-5 2024").toHuman(), "IHO P-5 Vol. 2024");
  // The v-shorthand pads to the dotted edition.
  assert.equal(impl.parse("IHO S-100 v5.1").toHuman(), "IHO S-100 5.1.0");
});

test("iho rejects non-identifiers", () => {
  const impl = grammarImplementation("iho")!;
  assert.throws(() => impl.parse("IHO X-1"));
  assert.throws(() => impl.parse("IHO S-"));
  assert.throws(() => impl.parse("IHO S-1 Part"));
});
