import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCorpus } from "../src/corpus/loader.js";
import { runFlavor } from "../src/conformance/runner.js";
import { PendingRegistry } from "../src/conformance/pending.js";
import { grammarImplementation } from "../src/flavors/index.js";
import type { IecIdentifier } from "../src/flavors/iec/model.js";
import { parse as parsePubidUrn } from "../src/pubid-urn/index.js";

// iec — the deepest flavor (12,334 rows, 16 identifier types, typed
// stages, positional-slot URNs), on the unified model.

const TESTSUITE_DIR =
  process.env["TESTSUITE_DIR"] ?? "../pubid-testsuite/tests";

test("every iec corpus case passes through the grammar", () => {
  const corpus = loadCorpus(TESTSUITE_DIR);
  const payloads = corpus.flavors.get("iec")!;
  const impl = grammarImplementation("iec")!;
  assert.ok(impl, "iec is grammar-backed");
  const report = runFlavor("iec", payloads, impl, new PendingRegistry());
  assert.equal(report.failures.length, 0, report.failures.slice(0, 12).join("; "));
  assert.equal(report.outcome, "pass");
  // Review rows (the debt fixtures' unparsed ground truths) report
  // separately and never gate.
  assert.equal(
    report.cases + report.review + report.quarantined,
    payloads.cases.length,
  );
  assert.ok(report.cases > 12000);
});

test("iec parses open-ended beyond the corpus", () => {
  const impl = grammarImplementation("iec")!;
  assert.equal(impl.parse("IEC FDIS 60038 ED2").toHuman(), "IEC FDIS 60038 ED2");
  assert.equal(impl.parse("IEV").toHuman(), "IEC 60050");
  assert.equal(impl.parse("IEC 61009-1:2020+AMD1:2021").toHuman(),
    "IEC 61009-1:2020+AMD1:2021");
});

test("iec rejects non-identifiers and guarded forms", () => {
  const impl = grammarImplementation("iec")!;
  assert.throws(() => impl.parse("IEC"));
  assert.throws(() => impl.parse("IECEE CAB-G01:2025-02"));
  assert.throws(() => impl.parse("IEC 60050-802/COR1/FRAGC1 ED1"));
});

// The dotted sub-number of an IEC draft supplement (pubid#725; the TS
// mirror of the gem's spec/pubid/iec/dot_subnumber_spec.rb). The ballot
// faces print it — "/DAM 2.3:2022", "/DCOR 1.3" on the base, and the
// dotted base designation "60038-2.3" in the ballot-prefix faces — and
// the ISO flavor has always kept its dot. The facet is ISO's
// `stage_iteration` on the layer whose designation carries the dot: on
// the SUPPLEMENT for the on-base draft faces, on the BASE for the
// ballot-prefix faces and the plain dotted base.
type DotRow = {
  input: string;
  render: string;
  iteration: string;
  number: string;
  type: string;
};

const dotRows: DotRow[] = [
  { input: "IEC 60038-2/DAM 2.3:2022", render: "IEC 60038-2/DAM 2.3:2022", iteration: "3", number: "2", type: "amendment" },
  // The token admits the multi-digit run.
  { input: "IEC 60038-2/DCOR 1.3", render: "IEC 60038-2/DCOR 1.3", iteration: "3", number: "1", type: "corrigendum" },
  { input: "IEC 60038-2/DAM 2.11:2022", render: "IEC 60038-2/DAM 2.11:2022", iteration: "11", number: "2", type: "amendment" },
];

for (const row of dotRows) {
  test(`iec dotted sub-number keeps the facet on the supplement: ${row.input}`, () => {
    const impl = grammarImplementation("iec")!;
    const id = impl.parse(row.input) as unknown as IecIdentifier;

    assert.equal(id.constructor.polymorphicName, `pubid:iec:${row.type}`);
    // The sub-number stays on the supplement's own designation.
    assert.equal(id.stageIterationValue(), row.iteration);
    assert.equal(id.number, row.number);
    assert.equal(id.toHuman(), row.render);

    // == its from_hash(to_hash) round trip, render included.
    const back = id.fromHash(id.toHash());
    assert.ok(back.equals!(id), "from_hash(to_hash) == parse");
    assert.equal(back.toHuman(), row.render);

    // The facet rides both URN schemes.
    assert.ok(id.toPubidUrn().endsWith(`iter-${row.iteration}`), id.toPubidUrn());
    assert.deepEqual(parsePubidUrn(id.toPubidUrn()).toHash(), id.toHash());
    // The official URN rides the dotted number in the supplement's
    // number slot; parsing it back keeps the facet.
    const token = row.type === "corrigendum" ? "cor" : "amd";
    assert.ok(id.toUrn()!.includes(`:${token}:${row.number}.${row.iteration}:`), id.toUrn());
    const rebuilt = impl.parseUrn!(id.toUrn()!) as unknown as IecIdentifier;
    assert.equal(rebuilt.stageIterationValue(), row.iteration);

    // Re-parses its own render to the same identifier.
    assert.ok(impl.parse(id.toHuman()).equals!(id));
  });
}

test("iec dotted sub-number: ballot-prefix faces decode onto the modern on-base parse", () => {
  const impl = grammarImplementation("iec")!;
  // The designation stays whole on the base: "IEC/FDAM 60038-2.3" is
  // base 60038-2 with stage iteration 3 — the same identity the plain
  // on-base parse of "IEC 60038-2.3" holds — plus the implied FDAM 1.
  const legacyFaces: [string, string][] = [
    ["IEC/FDAM 60038-2.3", "IEC 60038-2.3/FDAM 1"],
    ["IEC FDAM 60038-2.3", "IEC 60038-2.3/FDAM 1"],
    ["IEC DAM 60038-2.3", "IEC 60038-2.3/DAM 1"],
  ];
  for (const [input, modern] of legacyFaces) {
    const id = impl.parse(input) as unknown as IecIdentifier;
    const modernId = impl.parse(modern) as unknown as IecIdentifier;

    // Decodes onto the modern on-base parse.
    assert.ok(id.equals!(modernId), `${input} == ${modern}`);
    assert.deepEqual(id.toHash(), modernId.toHash());
    // The dot is on the BASE, not the supplement.
    assert.equal(id.base!.stageIterationValue(), "3");
    assert.equal(id.stageIterationValue(), undefined);
    assert.equal(id.toHuman(), modern);
    // == its from_hash(to_hash) round trip.
    assert.ok(id.fromHash(id.toHash()).equals!(id));
    // Re-parses its own render to the same identifier.
    assert.ok(impl.parse(id.toHuman()).equals!(id));
  }
});

test("iec dotted sub-number: the plain dotted base renders the dot", () => {
  const impl = grammarImplementation("iec")!;
  const id = impl.parse("IEC 60038-2.3") as unknown as IecIdentifier;

  // Keeps the sub-number losslessly at parse.
  assert.equal(id.stageIterationValue(), "3");
  assert.equal(id.number, "60038");
  assert.equal(id.part, "2");
  // The render used to drop the dot while toHash carried it — the
  // identifier rendered AS its sub-number-less twin.
  assert.equal(id.toHuman(), "IEC 60038-2.3");

  const back = id.fromHash(id.toHash());
  assert.ok(back.equals!(id), "from_hash(to_hash) == parse");
  assert.equal(back.toHuman(), "IEC 60038-2.3");

  // The facet rides the pubid-scheme URN.
  assert.equal(id.toPubidUrn(), "urn:pubid:iec:is:60038:part-2:iter-3");
  assert.deepEqual(parsePubidUrn(id.toPubidUrn()).toHash(), id.toHash());

  assert.ok(impl.parse(id.toHuman()).equals!(id));
});

test("iec dotted sub-number: unattested dotted ballot-number faces stay raising", () => {
  const impl = grammarImplementation("iec")!;
  // The ballot-prefix faces print the ballot NUMBER undotted ("ISO/IEC
  // PDAM 2 10646:2012"); a dotted ballot number is attested only on the
  // ON-BASE faces, so the prefix-face dotted number keeps raising rather
  // than guessing an identity for a spelling no source prints.
  assert.throws(() => impl.parse("IEC/DCOR 1.3 60038-2"));
  assert.throws(() => impl.parse("ISO/IEC PDAM 2.3 10646:2012"));
});
