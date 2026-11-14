import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCorpus } from "../src/corpus/loader.js";
import { runFlavor } from "../src/conformance/runner.js";
import { PendingRegistry } from "../src/conformance/pending.js";
import { grammarImplementation } from "../src/flavors/index.js";
import { BaseIdentifier } from "../src/model/identifier.js";
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

// pubid#727 (the TS mirror of the gem's spec/pubid/iec/dot_subnumber_spec.rb
// standalone block): the standalone (no-base, no-part) face with a dotted
// number — "IEC/AMD 1.2:2017" — parsed and then LOST the dot at render (the
// standalone face prints the base number and the supplement number only, so
// the stored stage_iteration was dropped and parse(render) != parse). No IEC
// source prints a no-part standalone face with a dotted number (the facet is
// attested only on the on-base draft faces), so the shape is rejected at
// parse — the same ruling as the prefix-face dotted ballot numbers above —
// instead of being built unrenderable. The SAME round fixes the crash the
// issue reported: the TS publisherPortion read copublishers off a supplement
// whose table does not materialize the empty collection (ruby nil-guards the
// same read, copublishers&.any?), so every parseable TS identifier renders.

// Every parseable neighbour of the rejected shape, probed on #727: the
// single-document draft faces carry the dot on the BASE (they are not
// supplements), the DAM-family prefix faces decode the dotted designation
// onto the base, and the on-base faces have a real base — all of them
// render the dot and re-parse to the same identifier. Renders verified
// byte-for-byte against the gem 2.0.32 oracle.
const standaloneKeepRows: [string, string][] = [
  ["IEC/CD 1.2:2017", "IEC CD 1.2:2017"],
  ["IEC/FDIS 1.2:2017", "IEC FDIS 1.2:2017"],
  ["IEC/DTR 1.2:2017", "IEC DTR 1.2:2017"],
  ["IEC/DTS 1.2:2017", "IEC DTS 1.2:2017"],
  ["IEC/DAM 1.2", "IEC 1.2/DAM 1"],
  ["IEC/FDAM 1.2:2017", "IEC 1.2:2017/FDAM 1"],
  ["IEC/DAM 2.3:2022", "IEC 2.3:2022/DAM 1"],
  ["IEC 60038-2/DAM 2.3:2022", "IEC 60038-2/DAM 2.3:2022"],
  ["IEC 60038-2/DCOR 1.3", "IEC 60038-2/DCOR 1.3"],
  ["IEC/FDAM 60038-2.3", "IEC 60038-2.3/FDAM 1"],
  ["IEC/AMD 60038-1:2017", "IEC 60038-1:2017/AMD1"],
];

for (const [input, render] of standaloneKeepRows) {
  test(`iec #727 neighbour keeps parsing: ${input}`, () => {
    const impl = grammarImplementation("iec")!;
    const id = impl.parse(input) as unknown as IecIdentifier;

    assert.equal(id.toHuman(), render);
    // == its from_hash(to_hash) round trip.
    const back = id.fromHash(id.toHash());
    assert.ok(back.equals!(id), "from_hash(to_hash) == parse");
    // Re-parses its own render to the same identifier.
    assert.ok(impl.parse(id.toHuman()).equals!(id));
  });
}

test("iec #727: the standalone no-part dotted face is rejected at parse", () => {
  const impl = grammarImplementation("iec")!;
  // The mixed-case token and the publisher-less and copublished spellings
  // bind the same standalone layout; a dotted layer under an undotted second
  // supplement rides the same self-base face one level down.
  const raising = [
    "IEC/AMD 1.2:2017", "IEC/AMD 1.2",
    "IEC/COR 1.2:2017",
    "IEC/DCOR 1.3:2017", "IEC/DCOR 1.3",
    "IEC/DISH 1.2:2017",
    "IEC/Amd 1.2:2017", "AMD 1.2:2017", "ISO/IEC/AMD 1.2:2017",
    "IEC/AMD 1.2:2017/COR 1:2018",
  ];
  for (const input of raising) {
    assert.throws(() => impl.parse(input), /dotted sub-number/, input);
  }
  // The synthetic raise: the check is the SHAPE on the BUILT object (the
  // gem walks the base chain after ensure_base), not a grammar failure —
  // the TS carrier is the flavor's parse-failure error with the gem's
  // message text (the ruby ParseError's input:/flavor:/cause-nil fields
  // have no TS counterpart on ParseFailed).
  assert.throws(() => impl.parse("IEC/AMD 1.2:2017"), (e: unknown) => {
    assert.match((e as Error).message, /no layer to print the dot on/);
    assert.match((e as Error).message, /attested only on the on-base draft forms/);
    return true;
  });
});

test("iec #727: the undotted standalone faces keep parsing (the #693 residue)", () => {
  const impl = grammarImplementation("iec")!;
  // The render of the self-base standalone prints its number twice (the
  // documented #693 residue: "IEC/AMD 1:2017" renders "IEC Amd 1-1:2017") —
  // unchanged by #727, which rejects only the DOTTED standalone face.
  // Re-parse is deliberately not asserted here, matching the gem rows: the
  // residue render re-parses as a supplement OF base 1-1, not to itself.
  const keep: [string, string][] = [
    ["IEC/AMD 1:2017", "IEC Amd 1-1:2017"],
    ["IEC/AMD 1", "IEC Amd 1-1"],
    ["IEC/DCOR 1:2017", "IEC DCOR 1-1:2017"],
    ["IEC/DISH 1:2017", "IEC DISH 1-1:2017"],
  ];
  for (const [input, render] of keep) {
    const id = impl.parse(input) as unknown as IecIdentifier;
    assert.equal(id.toHuman(), render, input);
    // == its from_hash(to_hash) round trip.
    assert.ok(id.fromHash(id.toHash()).equals!(id), input);
  }
});

test("iec #727: a pre-#727 stored hash still deserializes (deliberate residue)", () => {
  // from_hash is the deserialization path: a hash produced by a pre-#727
  // parse (the shape parsed before the reject) still builds. No published
  // relaton-data-iec row carries the shape — no source prints the face —
  // so nothing stored moves; the built object renders the undotted self-
  // base face, as it always did. Parse rejects the shape instead, so no
  // NEW hash of this shape can be produced by parsing.
  const stored = {
    _type: "pubid:iec:amendment",
    stage_iteration: "2",
    number: "1",
    year: "2017",
  };
  // The abstract polymorphic dispatch on _type (Pubid::Iec::Identifier
  // .from_hash's mirror): the registered amendment class rebuilds and
  // restores its own typed stage.
  const id = BaseIdentifier.fromHash(stored) as unknown as IecIdentifier;
  assert.equal(id.constructor.polymorphicName, "pubid:iec:amendment");
  assert.equal(id.toHuman(), "IEC Amd 1-1:2017");
});

// --- #187: the official-URN stage slot on the synthetic draft faces -----
//
// The TYPED_STAGES `harmonized` column IS the gem's
// harmonized_stages.first (pubid 2.0.32, verified in-process with
// parsanol 1.3.148): the lead code the official URN writes into its
// stage slot and the slot's parse side resolves back by (type, code).
// The corpus records none of these faces (its only stage slots are the
// working-programme stage-00.00/stage-10.20 rows), so this table is the
// record.
//
// Rows whose RENDER the gem normalizes onto the canonical abbreviation
// (PRF→FDIS, ADTR/CDTR/NDTR→DTR, ADTS/CDTS/NDTS→DTS, BPUB/PPUB→dropped)
// keep their TS render — the render face is a separate round; what
// aligns here is the URN slot, which the gem derives from the lead
// harmonized code of the typed stage every spelling decodes onto.
const stageSlotRows: [string, string, string][] = [
  // The IS ladder's draft faces — CD was the headline divergence (the
  // TS row claimed 30.20, the circulation slot, where the gem's :cd
  // ladder leads 30.00).
  ["IEC PWI 60038", "urn:iec:std:iec:60038::stage-00.00::",
    "urn:pubid:iec:is:60038:stage-pwi"],
  ["IEC NP 60038", "urn:iec:std:iec:60038::stage-10.00::",
    "urn:pubid:iec:is:60038:stage-np"],
  ["IEC PNW 60038", "urn:iec:std:iec:60038::stage-10.20::",
    "urn:pubid:iec:is:60038:stage-pnw"],
  ["IEC ANW 60038", "urn:iec:std:iec:60038::stage-10.99::",
    "urn:pubid:iec:is:60038:stage-anw"],
  ["IEC WD 60038", "urn:iec:std:iec:60038::stage-20.20::",
    "urn:pubid:iec:is:60038:stage-wd"],
  ["IEC CD 60038", "urn:iec:std:iec:60038::stage-30.00::",
    "urn:pubid:iec:is:60038:stage-cd"],
  ["IEC CDV 60038", "urn:iec:std:iec:60038::stage-40.00::",
    "urn:pubid:iec:is:60038:stage-cdv"],
  ["IEC FDIS 60038", "urn:iec:std:iec:60038::stage-50.00::",
    "urn:pubid:iec:is:60038:stage-fdis"],
  ["IEC PRF 60038", "urn:iec:std:iec:60038::stage-50.00::",
    "urn:pubid:iec:is:60038:stage-prf"],
  ["IEC BPUB 60038", "urn:iec:std:iec:60038::::",
    "urn:pubid:iec:is:60038:stage-bpub"],
  ["IEC PPUB 60038", "urn:iec:std:iec:60038::::",
    "urn:pubid:iec:is:60038:stage-ppub"],
  // A draft of a typed deliverable keeps both tokens, type first; every
  // draft spelling of one deliverable decodes onto the typed stage with
  // lead 50.00.
  ["IEC DTR 60038", "urn:iec:std:iec:60038::tr-stage-50.00::",
    "urn:pubid:iec:tr:60038:stage-dtr"],
  ["IEC ADTR 60038", "urn:iec:std:iec:60038::tr-stage-50.00::",
    "urn:pubid:iec:tr:60038:stage-adtr"],
  ["IEC CDTR 60038", "urn:iec:std:iec:60038::tr-stage-50.00::",
    "urn:pubid:iec:tr:60038:stage-cdtr"],
  ["IEC NDTR 60038", "urn:iec:std:iec:60038::tr-stage-50.00::",
    "urn:pubid:iec:tr:60038:stage-ndtr"],
  ["IEC DTS 62271-1", "urn:iec:std:iec:62271-1::ts-stage-50.00::",
    "urn:pubid:iec:ts:62271:part-1:stage-dts"],
  ["IEC ADTS 62271-1", "urn:iec:std:iec:62271-1::ts-stage-50.00::",
    "urn:pubid:iec:ts:62271:part-1:stage-adts"],
  ["IEC CDTS 62271-1", "urn:iec:std:iec:62271-1::ts-stage-50.00::",
    "urn:pubid:iec:ts:62271:part-1:stage-cdts"],
  ["IEC NDTS 62271-1", "urn:iec:std:iec:62271-1::ts-stage-50.00::",
    "urn:pubid:iec:ts:62271:part-1:stage-ndts"],
  ["IEC DPAS 62975", "urn:iec:std:iec:62975::pas-stage-50.00::",
    "urn:pubid:iec:pas:62975:stage-dpas"],
  // CDPAS decodes onto the committee-draft PAS row (lead 30.00) — the
  // gem's :cdpas registry row, not the 50.20 circulation slot the SSOT
  // table names (recorded as a gem-side contradiction below).
  ["IEC CDPAS 62975", "urn:iec:std:iec:62975::pas-stage-30.00::",
    "urn:pubid:iec:pas:62975:stage-cdpas"],
];

for (const [input, urn, purn] of stageSlotRows) {
  test(`iec #187 official-URN stage slot (gem parity): ${input}`, () => {
    const impl = grammarImplementation("iec")!;
    const id = impl.parse(input) as unknown as IecIdentifier;

    assert.equal(id.toUrn(), urn, input);
    assert.equal(id.toPubidUrn(), purn, input);
    // == its from_hash(to_hash) round trip.
    assert.ok(id.fromHash(id.toHash()).equals!(id), input);
    // Re-parses its own render to the same identifier.
    assert.ok(impl.parse(id.toHuman()).equals!(id), input);
  });
}

test("iec #187: the aligned slots resolve back through parseUrn (gem parity)", () => {
  const impl = grammarImplementation("iec")!;
  // The slot's parse side resolves (type, lead code) to the typed stage
  // and writes its canonical abbreviation into the code — the gem's
  // parse_urn answers (verified in-process): each URN round-trips.
  const resolutionRows: [string, string][] = [
    ["urn:iec:std:iec:60038::stage-00.00::", "IEC PWI 60038"],
    ["urn:iec:std:iec:60038::stage-10.00::", "IEC NP 60038"],
    ["urn:iec:std:iec:60038::stage-10.20::", "IEC PNW 60038"],
    ["urn:iec:std:iec:60038::stage-10.99::", "IEC ANW 60038"],
    ["urn:iec:std:iec:60038::stage-20.20::", "IEC WD 60038"],
    ["urn:iec:std:iec:60038::stage-30.00::", "IEC CD 60038"],
    ["urn:iec:std:iec:60038::stage-40.00::", "IEC CDV 60038"],
    ["urn:iec:std:iec:60038::stage-50.00::", "IEC FDIS 60038"],
    ["urn:iec:std:iec:60038::tr-stage-50.00::", "IEC DTR 60038"],
    ["urn:iec:std:iec:62271-1::ts-stage-50.00::", "IEC DTS 62271-1"],
    ["urn:iec:std:iec:62975::pas-stage-50.00::", "IEC DPAS 62975"],
    ["urn:iec:std:iec:62975::pas-stage-30.00::", "IEC CDPAS 62975"],
  ];
  for (const [urn, human] of resolutionRows) {
    const rebuilt = impl.parseUrn!(urn) as unknown as IecIdentifier;
    assert.equal(rebuilt.toHuman(), human, urn);
    assert.equal(rebuilt.toUrn(), urn, urn);
  }
  // The spellings whose render the gem normalizes round-trip through the
  // slot to the CANONICAL face, exactly as the gem's do (PRF's slot is
  // fdis's lead code; BPUB's slot is the published IS's empty one).
  const normalizedRows: [string, string][] = [
    ["IEC PRF 60038", "IEC FDIS 60038"],
    ["IEC BPUB 60038", "IEC 60038"],
    ["IEC PPUB 60038", "IEC 60038"],
    ["IEC ADTR 60038", "IEC DTR 60038"],
    ["IEC ADTS 62271-1", "IEC DTS 62271-1"],
  ];
  for (const [input, canonical] of normalizedRows) {
    const id = impl.parse(input) as unknown as IecIdentifier;
    const rebuilt = impl.parseUrn!(id.toUrn()!) as unknown as IecIdentifier;
    assert.equal(rebuilt.toHuman(), canonical, input);
  }
});

test("iec #187: the draft-supplement stages stay out of the official URN (gem parity)", () => {
  const impl = grammarImplementation("iec")!;
  // The official URN reads the ROOT's typed stage: an on-base draft
  // supplement names a published base, and a true standalone synthesizes
  // a stage-less one — so the supplement's own draft stage (PDAM, DAM,
  // FDAM, FPDAM, CDCor, DCOR, FDCOR, CDISH, DISH) rides only the pubid
  // URN's stage atom, never the official slot. This is the issue's
  // DCOR/DISH row: the TS fallback used to write the stage CODE into the
  // slot ("stage-dcor") where the gem writes nothing.
  const supplementRows: [string, string][] = [
    // On-base faces.
    ["IEC 60038-1/PDAM 1", "urn:iec:std:iec:60038-1::::::amd:1:"],
    ["IEC 60038-1/DAM 2", "urn:iec:std:iec:60038-1::::::amd:2:"],
    ["IEC 60038-1/FDAM 1", "urn:iec:std:iec:60038-1::::::amd:1:"],
    ["IEC 60038-1/FPDAM 1", "urn:iec:std:iec:60038-1::::::amd:1:"],
    ["IEC 60038-1/CDCor 1", "urn:iec:std:iec:60038-1::::::cor:1:"],
    ["IEC 60038-1/DCOR 1", "urn:iec:std:iec:60038-1::::::cor:1:"],
    ["IEC 60038-1/FDCOR 1", "urn:iec:std:iec:60038-1::::::cor:1:"],
    ["IEC 60038-1/CDISH 1", "urn:iec:std:iec:60038-1::::::ish:1:"],
    ["IEC 60038-1/DISH 1", "urn:iec:std:iec:60038-1::::::ish:1:"],
    // The legacy ballot-prefix faces decode onto the modern on-base
    // parse, so they mint the same URN.
    ["IEC/PDAM 60038-1", "urn:iec:std:iec:60038-1::::::amd:1:"],
    ["IEC/DAM 60038-1", "urn:iec:std:iec:60038-1::::::amd:1:"],
    ["IEC/FDAM 60038-1", "urn:iec:std:iec:60038-1::::::amd:1:"],
    ["IEC/FPDAM 60038-1", "urn:iec:std:iec:60038-1::::::amd:1:"],
    ["IEC/CDCOR 60038-1", "urn:iec:std:iec:60038-1::::::cor:1:"],
    ["IEC/DCOR 60038-1", "urn:iec:std:iec:60038-1::::::cor:1:"],
    ["IEC/FDCOR 60038-1", "urn:iec:std:iec:60038-1::::::cor:1:"],
    ["IEC/CDISH 60038-1", "urn:iec:std:iec:60038-1::::::ish:1:"],
    ["IEC/DISH 60038-1", "urn:iec:std:iec:60038-1::::::ish:1:"],
    // The true standalone faces (the #693 residue renders): the
    // synthetic self-base carries no stage, so the slot stays empty
    // while the pubid URN keeps the stage atom.
    ["IEC/AMD 1:2017", "urn:iec:std:iec:1:2017:::::amd:1:2017"],
    ["IEC/DCOR 1:2017", "urn:iec:std:iec:1:2017:::::cor:1:2017"],
    ["IEC/DISH 1:2017", "urn:iec:std:iec:1:2017:::::ish:1:2017"],
    ["IEC/CDISH 1:2017", "urn:iec:std:iec:1:2017:::::ish:1:2017"],
  ];
  for (const [input, urn] of supplementRows) {
    const id = impl.parse(input) as unknown as IecIdentifier;
    assert.equal(id.toUrn(), urn, input);
    assert.ok(!id.toUrn()!.includes("stage-"), input);
  }
  // The pubid URN keeps the supplement's draft stage where the official
  // slot drops it (gem parity: stage-pdam/stage-dcor ... atoms).
  const purnRows: [string, string][] = [
    ["IEC 60038-1/PDAM 1", "urn:pubid:iec:is:60038:part-1:amd:1:stage-pdam"],
    ["IEC 60038-1/DCOR 1", "urn:pubid:iec:is:60038:part-1:cor:1:stage-dcor"],
    ["IEC/DCOR 1:2017", "urn:pubid:iec:cor:1:year-2017:stage-dcor"],
    ["IEC/DISH 1:2017", "urn:pubid:iec:is2:1:year-2017:stage-dish"],
  ];
  for (const [input, purn] of purnRows) {
    const id = impl.parse(input) as unknown as IecIdentifier;
    assert.equal(id.toPubidUrn(), purn, input);
  }
});

test("iec #187: the published faces keep their empty slots (gem parity)", () => {
  const impl = grammarImplementation("iec")!;
  const publishedRows: [string, string][] = [
    ["IEC 60038", "urn:iec:std:iec:60038::::"],
    ["IEC TR 60038", "urn:iec:std:iec:60038::tr::"],
    ["IEC TS 60038", "urn:iec:std:iec:60038::ts::"],
    ["IEC PAS 62975", "urn:iec:std:iec:62975::pas::"],
    ["IEC GUIDE 104", "urn:iec:std:iec:104::guide::"],
    ["IEC 60038-1/COR 1", "urn:iec:std:iec:60038-1::::::cor:1:"],
    ["IEC 60038-1/ISH 1", "urn:iec:std:iec:60038-1::::::ish:1:"],
    ["IEC 60038-1/AMD 1", "urn:iec:std:iec:60038-1::::::amd:1:"],
  ];
  for (const [input, urn] of publishedRows) {
    const id = impl.parse(input) as unknown as IecIdentifier;
    assert.equal(id.toUrn(), urn, input);
  }
});

