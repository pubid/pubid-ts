import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCorpus } from "../src/corpus/loader.js";
import { runFlavor } from "../src/conformance/runner.js";
import { PendingRegistry } from "../src/conformance/pending.js";
import { grammarImplementation } from "../src/flavors/index.js";
import { BaseIdentifier } from "../src/model/identifier.js";
import type { IecIdentifier } from "../src/flavors/iec/model.js";
import { parse as parsePubidUrn } from "../src/pubid-urn/index.js";

// iec — the deepest flavor (12,334 rows, 19 identifier types, typed
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
// aligned their URN slot here and their RENDER face in #190: the slot is
// the lead harmonized code of the typed stage every spelling decodes
// onto, the render face is the row's canonical abbreviation, and the
// pubid URN's stage atom is the folded row's CODE — so "IEC PRF 60038"
// carries stage-50.00 in the official slot and stage-fdis in the pubid
// URN, exactly the gem's answers (verified in-process at 2.0.32).
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
    "urn:pubid:iec:is:60038:stage-fdis"],
  ["IEC BPUB 60038", "urn:iec:std:iec:60038::::",
    "urn:pubid:iec:is:60038"],
  ["IEC PPUB 60038", "urn:iec:std:iec:60038::::",
    "urn:pubid:iec:is:60038"],
  // A draft of a typed deliverable keeps both tokens, type first; every
  // draft spelling of one deliverable decodes onto the typed stage with
  // lead 50.00.
  ["IEC DTR 60038", "urn:iec:std:iec:60038::tr-stage-50.00::",
    "urn:pubid:iec:tr:60038:stage-dtr"],
  ["IEC ADTR 60038", "urn:iec:std:iec:60038::tr-stage-50.00::",
    "urn:pubid:iec:tr:60038:stage-dtr"],
  ["IEC CDTR 60038", "urn:iec:std:iec:60038::tr-stage-50.00::",
    "urn:pubid:iec:tr:60038:stage-dtr"],
  ["IEC NDTR 60038", "urn:iec:std:iec:60038::tr-stage-50.00::",
    "urn:pubid:iec:tr:60038:stage-dtr"],
  ["IEC DTS 62271-1", "urn:iec:std:iec:62271-1::ts-stage-50.00::",
    "urn:pubid:iec:ts:62271:part-1:stage-dts"],
  ["IEC ADTS 62271-1", "urn:iec:std:iec:62271-1::ts-stage-50.00::",
    "urn:pubid:iec:ts:62271:part-1:stage-dts"],
  ["IEC CDTS 62271-1", "urn:iec:std:iec:62271-1::ts-stage-50.00::",
    "urn:pubid:iec:ts:62271:part-1:stage-dts"],
  ["IEC NDTS 62271-1", "urn:iec:std:iec:62271-1::ts-stage-50.00::",
    "urn:pubid:iec:ts:62271:part-1:stage-dts"],
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

// --- #190: the render face follows the gem's canonical abbreviation ------
//
// The gem renders every typed-stage spelling onto its row's canonical
// abbreviation (renderer.rb: `id.typed_stage.abbr.first`) and serializes
// typed_stage.code on the wire. The TS mirrors the gem 2.0.32 rows one
// for one (one row per deliverable stage; the spellings are tokens on
// the row): PRF folds onto :fdis, the publication-lifecycle spellings
// (BPUB, PPUB) onto the published IS whose abbr is "" — the
// abbreviation drops from the render — and the ADTR/CDTR/NDTR family
// onto :dtr, the ADTS/CDTS/NDTS family onto :dts.
//
// This table is the record: the full probe matrix (every #190 stage
// standalone, with a part, dated, with an edition), each row verified
// byte-for-byte against gem 2.0.32 in-process (source checkout,
// Pubid::VERSION-checked: to_s, class, typed stage code/stage_code/
// abbr.first/lead harmonized code, official URN, pubid URN, hash
// round-trip, render re-parse).
const renderFaceRows: [string, string, string, string, string | null, string][] = [
  // PRF -> FDIS.
  ["IEC PRF 60038", "IEC FDIS 60038", "urn:iec:std:iec:60038::stage-50.00::", "urn:pubid:iec:is:60038:stage-fdis", "fdis", "international-standard"],
  ["IEC PRF 60038-1", "IEC FDIS 60038-1", "urn:iec:std:iec:60038-1::stage-50.00::", "urn:pubid:iec:is:60038:part-1:stage-fdis", "fdis", "international-standard"],
  ["IEC PRF 60038:2024", "IEC FDIS 60038:2024", "urn:iec:std:iec:60038:2024:stage-50.00::", "urn:pubid:iec:is:60038:year-2024:stage-fdis", "fdis", "international-standard"],
  ["IEC PRF 60038 ED2", "IEC FDIS 60038 ED2", "urn:iec:std:iec:60038::stage-50.00:ed-2:", "urn:pubid:iec:is:60038:ed-2:stage-fdis", "fdis", "international-standard"],
  // BPUB/PPUB -> the published IS: abbreviation and stage atom drop.
  ["IEC BPUB 60038", "IEC 60038", "urn:iec:std:iec:60038::::", "urn:pubid:iec:is:60038", null, "international-standard"],
  ["IEC BPUB 60038-1", "IEC 60038-1", "urn:iec:std:iec:60038-1::::", "urn:pubid:iec:is:60038:part-1", null, "international-standard"],
  ["IEC BPUB 60038:2024", "IEC 60038:2024", "urn:iec:std:iec:60038:2024:::", "urn:pubid:iec:is:60038:year-2024", null, "international-standard"],
  ["IEC BPUB 60038 ED2", "IEC 60038 ED2", "urn:iec:std:iec:60038:::ed-2:", "urn:pubid:iec:is:60038:ed-2", null, "international-standard"],
  ["IEC PPUB 60038", "IEC 60038", "urn:iec:std:iec:60038::::", "urn:pubid:iec:is:60038", null, "international-standard"],
  ["IEC PPUB 60038-1", "IEC 60038-1", "urn:iec:std:iec:60038-1::::", "urn:pubid:iec:is:60038:part-1", null, "international-standard"],
  ["IEC PPUB 60038:2024", "IEC 60038:2024", "urn:iec:std:iec:60038:2024:::", "urn:pubid:iec:is:60038:year-2024", null, "international-standard"],
  ["IEC PPUB 60038 ED2", "IEC 60038 ED2", "urn:iec:std:iec:60038:::ed-2:", "urn:pubid:iec:is:60038:ed-2", null, "international-standard"],
  // ADTR/CDTR/NDTR -> DTR.
  ["IEC ADTR 60038", "IEC DTR 60038", "urn:iec:std:iec:60038::tr-stage-50.00::", "urn:pubid:iec:tr:60038:stage-dtr", "dtr", "technical-report"],
  ["IEC ADTR 60038-1", "IEC DTR 60038-1", "urn:iec:std:iec:60038-1::tr-stage-50.00::", "urn:pubid:iec:tr:60038:part-1:stage-dtr", "dtr", "technical-report"],
  ["IEC ADTR 60038:2024", "IEC DTR 60038:2024", "urn:iec:std:iec:60038:2024:tr-stage-50.00::", "urn:pubid:iec:tr:60038:year-2024:stage-dtr", "dtr", "technical-report"],
  ["IEC ADTR 60038 ED2", "IEC DTR 60038 ED2", "urn:iec:std:iec:60038::tr-stage-50.00:ed-2:", "urn:pubid:iec:tr:60038:ed-2:stage-dtr", "dtr", "technical-report"],
  ["IEC CDTR 60038", "IEC DTR 60038", "urn:iec:std:iec:60038::tr-stage-50.00::", "urn:pubid:iec:tr:60038:stage-dtr", "dtr", "technical-report"],
  ["IEC CDTR 60038-1", "IEC DTR 60038-1", "urn:iec:std:iec:60038-1::tr-stage-50.00::", "urn:pubid:iec:tr:60038:part-1:stage-dtr", "dtr", "technical-report"],
  ["IEC CDTR 60038:2024", "IEC DTR 60038:2024", "urn:iec:std:iec:60038:2024:tr-stage-50.00::", "urn:pubid:iec:tr:60038:year-2024:stage-dtr", "dtr", "technical-report"],
  ["IEC CDTR 60038 ED2", "IEC DTR 60038 ED2", "urn:iec:std:iec:60038::tr-stage-50.00:ed-2:", "urn:pubid:iec:tr:60038:ed-2:stage-dtr", "dtr", "technical-report"],
  ["IEC NDTR 60038", "IEC DTR 60038", "urn:iec:std:iec:60038::tr-stage-50.00::", "urn:pubid:iec:tr:60038:stage-dtr", "dtr", "technical-report"],
  ["IEC NDTR 60038-1", "IEC DTR 60038-1", "urn:iec:std:iec:60038-1::tr-stage-50.00::", "urn:pubid:iec:tr:60038:part-1:stage-dtr", "dtr", "technical-report"],
  ["IEC NDTR 60038:2024", "IEC DTR 60038:2024", "urn:iec:std:iec:60038:2024:tr-stage-50.00::", "urn:pubid:iec:tr:60038:year-2024:stage-dtr", "dtr", "technical-report"],
  ["IEC NDTR 60038 ED2", "IEC DTR 60038 ED2", "urn:iec:std:iec:60038::tr-stage-50.00:ed-2:", "urn:pubid:iec:tr:60038:ed-2:stage-dtr", "dtr", "technical-report"],
  // ADTS/CDTS/NDTS -> DTS.
  ["IEC ADTS 60038", "IEC DTS 60038", "urn:iec:std:iec:60038::ts-stage-50.00::", "urn:pubid:iec:ts:60038:stage-dts", "dts", "technical-specification"],
  ["IEC ADTS 60038-1", "IEC DTS 60038-1", "urn:iec:std:iec:60038-1::ts-stage-50.00::", "urn:pubid:iec:ts:60038:part-1:stage-dts", "dts", "technical-specification"],
  ["IEC ADTS 60038:2024", "IEC DTS 60038:2024", "urn:iec:std:iec:60038:2024:ts-stage-50.00::", "urn:pubid:iec:ts:60038:year-2024:stage-dts", "dts", "technical-specification"],
  ["IEC ADTS 60038 ED2", "IEC DTS 60038 ED2", "urn:iec:std:iec:60038::ts-stage-50.00:ed-2:", "urn:pubid:iec:ts:60038:ed-2:stage-dts", "dts", "technical-specification"],
  ["IEC CDTS 60038", "IEC DTS 60038", "urn:iec:std:iec:60038::ts-stage-50.00::", "urn:pubid:iec:ts:60038:stage-dts", "dts", "technical-specification"],
  ["IEC CDTS 60038-1", "IEC DTS 60038-1", "urn:iec:std:iec:60038-1::ts-stage-50.00::", "urn:pubid:iec:ts:60038:part-1:stage-dts", "dts", "technical-specification"],
  ["IEC CDTS 60038:2024", "IEC DTS 60038:2024", "urn:iec:std:iec:60038:2024:ts-stage-50.00::", "urn:pubid:iec:ts:60038:year-2024:stage-dts", "dts", "technical-specification"],
  ["IEC CDTS 60038 ED2", "IEC DTS 60038 ED2", "urn:iec:std:iec:60038::ts-stage-50.00:ed-2:", "urn:pubid:iec:ts:60038:ed-2:stage-dts", "dts", "technical-specification"],
  ["IEC NDTS 60038", "IEC DTS 60038", "urn:iec:std:iec:60038::ts-stage-50.00::", "urn:pubid:iec:ts:60038:stage-dts", "dts", "technical-specification"],
  ["IEC NDTS 60038-1", "IEC DTS 60038-1", "urn:iec:std:iec:60038-1::ts-stage-50.00::", "urn:pubid:iec:ts:60038:part-1:stage-dts", "dts", "technical-specification"],
  ["IEC NDTS 60038:2024", "IEC DTS 60038:2024", "urn:iec:std:iec:60038:2024:ts-stage-50.00::", "urn:pubid:iec:ts:60038:year-2024:stage-dts", "dts", "technical-specification"],
  ["IEC NDTS 60038 ED2", "IEC DTS 60038 ED2", "urn:iec:std:iec:60038::ts-stage-50.00:ed-2:", "urn:pubid:iec:ts:60038:ed-2:stage-dts", "dts", "technical-specification"],
  // The canonical twins are the normalization's no-op guard: the folded
  // spellings parse, render, hash and URN IDENTICALLY to these.
  ["IEC FDIS 60038", "IEC FDIS 60038", "urn:iec:std:iec:60038::stage-50.00::", "urn:pubid:iec:is:60038:stage-fdis", "fdis", "international-standard"],
  ["IEC FDIS 60038-1", "IEC FDIS 60038-1", "urn:iec:std:iec:60038-1::stage-50.00::", "urn:pubid:iec:is:60038:part-1:stage-fdis", "fdis", "international-standard"],
  ["IEC FDIS 60038:2024", "IEC FDIS 60038:2024", "urn:iec:std:iec:60038:2024:stage-50.00::", "urn:pubid:iec:is:60038:year-2024:stage-fdis", "fdis", "international-standard"],
  ["IEC FDIS 60038 ED2", "IEC FDIS 60038 ED2", "urn:iec:std:iec:60038::stage-50.00:ed-2:", "urn:pubid:iec:is:60038:ed-2:stage-fdis", "fdis", "international-standard"],
  ["IEC DTR 60038", "IEC DTR 60038", "urn:iec:std:iec:60038::tr-stage-50.00::", "urn:pubid:iec:tr:60038:stage-dtr", "dtr", "technical-report"],
  ["IEC DTR 60038-1", "IEC DTR 60038-1", "urn:iec:std:iec:60038-1::tr-stage-50.00::", "urn:pubid:iec:tr:60038:part-1:stage-dtr", "dtr", "technical-report"],
  ["IEC DTR 60038:2024", "IEC DTR 60038:2024", "urn:iec:std:iec:60038:2024:tr-stage-50.00::", "urn:pubid:iec:tr:60038:year-2024:stage-dtr", "dtr", "technical-report"],
  ["IEC DTR 60038 ED2", "IEC DTR 60038 ED2", "urn:iec:std:iec:60038::tr-stage-50.00:ed-2:", "urn:pubid:iec:tr:60038:ed-2:stage-dtr", "dtr", "technical-report"],
  ["IEC DTS 60038", "IEC DTS 60038", "urn:iec:std:iec:60038::ts-stage-50.00::", "urn:pubid:iec:ts:60038:stage-dts", "dts", "technical-specification"],
  ["IEC DTS 60038-1", "IEC DTS 60038-1", "urn:iec:std:iec:60038-1::ts-stage-50.00::", "urn:pubid:iec:ts:60038:part-1:stage-dts", "dts", "technical-specification"],
  ["IEC DTS 60038:2024", "IEC DTS 60038:2024", "urn:iec:std:iec:60038:2024:ts-stage-50.00::", "urn:pubid:iec:ts:60038:year-2024:stage-dts", "dts", "technical-specification"],
  ["IEC DTS 60038 ED2", "IEC DTS 60038 ED2", "urn:iec:std:iec:60038::ts-stage-50.00:ed-2:", "urn:pubid:iec:ts:60038:ed-2:stage-dts", "dts", "technical-specification"],
  ["IEC CDV 60038", "IEC CDV 60038", "urn:iec:std:iec:60038::stage-40.00::", "urn:pubid:iec:is:60038:stage-cdv", "cdv", "international-standard"],
  ["IEC CDV 60038-1", "IEC CDV 60038-1", "urn:iec:std:iec:60038-1::stage-40.00::", "urn:pubid:iec:is:60038:part-1:stage-cdv", "cdv", "international-standard"],
  ["IEC CDV 60038:2024", "IEC CDV 60038:2024", "urn:iec:std:iec:60038:2024:stage-40.00::", "urn:pubid:iec:is:60038:year-2024:stage-cdv", "cdv", "international-standard"],
  ["IEC CDV 60038 ED2", "IEC CDV 60038 ED2", "urn:iec:std:iec:60038::stage-40.00:ed-2:", "urn:pubid:iec:is:60038:ed-2:stage-cdv", "cdv", "international-standard"],
  ["IEC CD 60038", "IEC CD 60038", "urn:iec:std:iec:60038::stage-30.00::", "urn:pubid:iec:is:60038:stage-cd", "cd", "international-standard"],
  ["IEC CD 60038-1", "IEC CD 60038-1", "urn:iec:std:iec:60038-1::stage-30.00::", "urn:pubid:iec:is:60038:part-1:stage-cd", "cd", "international-standard"],
  ["IEC CD 60038:2024", "IEC CD 60038:2024", "urn:iec:std:iec:60038:2024:stage-30.00::", "urn:pubid:iec:is:60038:year-2024:stage-cd", "cd", "international-standard"],
  ["IEC CD 60038 ED2", "IEC CD 60038 ED2", "urn:iec:std:iec:60038::stage-30.00:ed-2:", "urn:pubid:iec:is:60038:ed-2:stage-cd", "cd", "international-standard"],
  // The published faces the drops normalize onto.
  ["IEC 60038", "IEC 60038", "urn:iec:std:iec:60038::::", "urn:pubid:iec:is:60038", null, "international-standard"],
  ["IEC 60038-1", "IEC 60038-1", "urn:iec:std:iec:60038-1::::", "urn:pubid:iec:is:60038:part-1", null, "international-standard"],
  ["IEC TR 60038", "IEC TR 60038", "urn:iec:std:iec:60038::tr::", "urn:pubid:iec:tr:60038", null, "technical-report"],
];

for (const [input, render, urn, purn, stage, type] of renderFaceRows) {
  test(`iec #190 render face follows the gem's canonical abbreviation: ${input}`, () => {
    const impl = grammarImplementation("iec")!;
    const id = impl.parse(input) as unknown as IecIdentifier;

    assert.equal(id.constructor.polymorphicName, `pubid:iec:${type}`, input);
    assert.equal(id.toHuman(), render, input);
    assert.equal(id.toUrn(), urn, input);
    assert.equal(id.toPubidUrn(), purn, input);
    // The wire carries the folded row's CODE for drafts, none for the
    // published stage.
    assert.equal((id.toHash() as Record<string, unknown>)["stage"] ?? null, stage, input);
    // == its from_hash(to_hash) round trip, render included.
    const back = id.fromHash(id.toHash());
    assert.ok(back.equals!(id), `from_hash(to_hash) == parse: ${input}`);
    assert.equal(back.toHuman(), render, input);
    // Re-parses its own render to the same identifier (the normalization
    // is a fixed point).
    assert.ok(impl.parse(id.toHuman()).equals!(id), `parse(render) == parse: ${input}`);
  });
}



// --- #191: the grammar parses the spellings the gem parses --------------
//
// The gem's compiled IEC grammar (data/parg/iec.json) accepts the
// prefixed Committee-Draft spellings (2CD..9CD, ACD, A2CD..A9CD, CDM),
// the CDV-family spellings (ACDV, CCDV, CDVM, NCDV), the fdis-family
// spellings (NFDIS, NADIS, RDISH, RFDIS, CFDIS), the
// publication-lifecycle spellings (APUB, WPUB, DELPUB, RR), the PWI
// family (NWIP, BWG, AWIN, AMW), the DTR-family spellings (DTRM, and
// DTSM — which the gem's :dtr row lists even though the name belongs to
// the TS deliverable), and the two-token type faces ("IEC CD TR 62048"
// -> the combined cd_tr typed stage; the whole PWI/NP/ANW/WD/CD ladder
// of TR, TS, PAS and Guide). The TS mirror accepts exactly the gem's
// grammar token set, decoded onto the same folded rows (model.ts).
//
// This table is the record: every newly-parsing row verified
// byte-for-byte against gem 2.0.32 in-process (to_s, class, typed stage
// code/abbreviation/lead harmonized code, official URN, pubid URN, hash
// round-trip, render re-parse).
const parseParityRows: [string, string, string, string, string, string][] = [
  // The 2CD family decodes onto :cd.
  ["IEC 2CD 60038", "IEC CD 60038", "urn:iec:std:iec:60038::stage-30.00::", "urn:pubid:iec:is:60038:stage-cd", "cd", "international-standard"],
  ["IEC 3CD 60038", "IEC CD 60038", "urn:iec:std:iec:60038::stage-30.00::", "urn:pubid:iec:is:60038:stage-cd", "cd", "international-standard"],
  ["IEC 4CD 60038", "IEC CD 60038", "urn:iec:std:iec:60038::stage-30.00::", "urn:pubid:iec:is:60038:stage-cd", "cd", "international-standard"],
  ["IEC 9CD 60038", "IEC CD 60038", "urn:iec:std:iec:60038::stage-30.00::", "urn:pubid:iec:is:60038:stage-cd", "cd", "international-standard"],
  ["IEC ACD 60038", "IEC CD 60038", "urn:iec:std:iec:60038::stage-30.00::", "urn:pubid:iec:is:60038:stage-cd", "cd", "international-standard"],
  ["IEC A2CD 60038", "IEC CD 60038", "urn:iec:std:iec:60038::stage-30.00::", "urn:pubid:iec:is:60038:stage-cd", "cd", "international-standard"],
  ["IEC A9CD 60038", "IEC CD 60038", "urn:iec:std:iec:60038::stage-30.00::", "urn:pubid:iec:is:60038:stage-cd", "cd", "international-standard"],
  ["IEC CDM 60038", "IEC CD 60038", "urn:iec:std:iec:60038::stage-30.00::", "urn:pubid:iec:is:60038:stage-cd", "cd", "international-standard"],
  // The CDV family decodes onto :cdv.
  ["IEC ACDV 60038", "IEC CDV 60038", "urn:iec:std:iec:60038::stage-40.00::", "urn:pubid:iec:is:60038:stage-cdv", "cdv", "international-standard"],
  ["IEC CCDV 60038", "IEC CDV 60038", "urn:iec:std:iec:60038::stage-40.00::", "urn:pubid:iec:is:60038:stage-cdv", "cdv", "international-standard"],
  ["IEC CDVM 60038", "IEC CDV 60038", "urn:iec:std:iec:60038::stage-40.00::", "urn:pubid:iec:is:60038:stage-cdv", "cdv", "international-standard"],
  ["IEC NCDV 60038", "IEC CDV 60038", "urn:iec:std:iec:60038::stage-40.00::", "urn:pubid:iec:is:60038:stage-cdv", "cdv", "international-standard"],
  // The fdis family decodes onto :fdis.
  ["IEC NFDIS 60038", "IEC FDIS 60038", "urn:iec:std:iec:60038::stage-50.00::", "urn:pubid:iec:is:60038:stage-fdis", "fdis", "international-standard"],
  ["IEC NADIS 60038", "IEC FDIS 60038", "urn:iec:std:iec:60038::stage-50.00::", "urn:pubid:iec:is:60038:stage-fdis", "fdis", "international-standard"],
  ["IEC RDISH 60038", "IEC FDIS 60038", "urn:iec:std:iec:60038::stage-50.00::", "urn:pubid:iec:is:60038:stage-fdis", "fdis", "international-standard"],
  ["IEC RFDIS 60038", "IEC FDIS 60038", "urn:iec:std:iec:60038::stage-50.00::", "urn:pubid:iec:is:60038:stage-fdis", "fdis", "international-standard"],
  ["IEC CFDIS 60038", "IEC FDIS 60038", "urn:iec:std:iec:60038::stage-50.00::", "urn:pubid:iec:is:60038:stage-fdis", "fdis", "international-standard"],
  // The publication-lifecycle spellings decode onto the published IS.
  ["IEC APUB 60038", "IEC 60038", "urn:iec:std:iec:60038::::", "urn:pubid:iec:is:60038", "", "international-standard"],
  ["IEC APUB 60038-1", "IEC 60038-1", "urn:iec:std:iec:60038-1::::", "urn:pubid:iec:is:60038:part-1", "", "international-standard"],
  ["IEC WPUB 60038", "IEC 60038", "urn:iec:std:iec:60038::::", "urn:pubid:iec:is:60038", "", "international-standard"],
  ["IEC DELPUB 60038", "IEC 60038", "urn:iec:std:iec:60038::::", "urn:pubid:iec:is:60038", "", "international-standard"],
  ["IEC RR 60038", "IEC 60038", "urn:iec:std:iec:60038::::", "urn:pubid:iec:is:60038", "", "international-standard"],
  // The PWI family decodes onto :pwi.
  ["IEC NWIP 60038", "IEC PWI 60038", "urn:iec:std:iec:60038::stage-00.00::", "urn:pubid:iec:is:60038:stage-pwi", "pwi", "international-standard"],
  ["IEC BWG 60038", "IEC PWI 60038", "urn:iec:std:iec:60038::stage-00.00::", "urn:pubid:iec:is:60038:stage-pwi", "pwi", "international-standard"],
  ["IEC AWIN 60038", "IEC PWI 60038", "urn:iec:std:iec:60038::stage-00.00::", "urn:pubid:iec:is:60038:stage-pwi", "pwi", "international-standard"],
  ["IEC AMW 60038", "IEC PWI 60038", "urn:iec:std:iec:60038::stage-00.00::", "urn:pubid:iec:is:60038:stage-pwi", "pwi", "international-standard"],
  // The DTR family — DTSM rides the :dtr row in the gem's registry (the
  // TS row is never scanned), so it decodes onto the TR ladder, the
  // gem-side wobble mirrored.
  ["IEC DTRM 60038", "IEC DTR 60038", "urn:iec:std:iec:60038::tr-stage-50.00::", "urn:pubid:iec:tr:60038:stage-dtr", "dtr", "technical-report"],
  ["IEC DTSM 60038", "IEC DTR 60038", "urn:iec:std:iec:60038::tr-stage-50.00::", "urn:pubid:iec:tr:60038:stage-dtr", "dtr", "technical-report"],
  // The two-token type faces: the per-deliverable TR ladder.
  ["IEC CD TR 62048", "IEC CD TR 62048", "urn:iec:std:iec:62048::tr-stage-30.00::", "urn:pubid:iec:tr:62048:stage-cd_tr", "cd_tr", "technical-report"],
  ["IEC CD TR 62048-1", "IEC CD TR 62048-1", "urn:iec:std:iec:62048-1::tr-stage-30.00::", "urn:pubid:iec:tr:62048:part-1:stage-cd_tr", "cd_tr", "technical-report"],
  ["IEC CD TR 62048:2024", "IEC CD TR 62048:2024", "urn:iec:std:iec:62048:2024:tr-stage-30.00::", "urn:pubid:iec:tr:62048:year-2024:stage-cd_tr", "cd_tr", "technical-report"],
  ["IEC PWI TR 62048", "IEC PWI TR 62048", "urn:iec:std:iec:62048::tr-stage-00.00::", "urn:pubid:iec:tr:62048:stage-pwi_tr", "pwi_tr", "technical-report"],
  ["IEC NP TR 62048", "IEC NP TR 62048", "urn:iec:std:iec:62048::tr-stage-10.00::", "urn:pubid:iec:tr:62048:stage-np_tr", "np_tr", "technical-report"],
  ["IEC ANW TR 62048", "IEC ANW TR 62048", "urn:iec:std:iec:62048::tr-stage-10.99::", "urn:pubid:iec:tr:62048:stage-anw_tr", "anw_tr", "technical-report"],
  ["IEC WD TR 62048", "IEC WD TR 62048", "urn:iec:std:iec:62048::tr-stage-20.20::", "urn:pubid:iec:tr:62048:stage-wd_tr", "wd_tr", "technical-report"],
  // The TS ladder.
  ["IEC CD TS 62048", "IEC CD TS 62048", "urn:iec:std:iec:62048::ts-stage-30.00::", "urn:pubid:iec:ts:62048:stage-cd_ts", "cd_ts", "technical-specification"],
  ["IEC PWI TS 62048", "IEC PWI TS 62048", "urn:iec:std:iec:62048::ts-stage-00.00::", "urn:pubid:iec:ts:62048:stage-pwi_ts", "pwi_ts", "technical-specification"],
  ["IEC NP TS 62048", "IEC NP TS 62048", "urn:iec:std:iec:62048::ts-stage-10.00::", "urn:pubid:iec:ts:62048:stage-np_ts", "np_ts", "technical-specification"],
  ["IEC ANW TS 62048", "IEC ANW TS 62048", "urn:iec:std:iec:62048::ts-stage-10.99::", "urn:pubid:iec:ts:62048:stage-anw_ts", "anw_ts", "technical-specification"],
  ["IEC WD TS 62048", "IEC WD TS 62048", "urn:iec:std:iec:62048::ts-stage-20.20::", "urn:pubid:iec:ts:62048:stage-wd_ts", "wd_ts", "technical-specification"],
  // The PAS ladder.
  ["IEC PWI PAS 62975", "IEC PWI PAS 62975", "urn:iec:std:iec:62975::pas-stage-00.00::", "urn:pubid:iec:pas:62975:stage-pwi_pas", "pwi_pas", "publicly-available-specification"],
  ["IEC NP PAS 62975", "IEC NP PAS 62975", "urn:iec:std:iec:62975::pas-stage-10.00::", "urn:pubid:iec:pas:62975:stage-np_pas", "np_pas", "publicly-available-specification"],
  ["IEC ANW PAS 62975", "IEC ANW PAS 62975", "urn:iec:std:iec:62975::pas-stage-10.99::", "urn:pubid:iec:pas:62975:stage-anw_pas", "anw_pas", "publicly-available-specification"],
  ["IEC WD PAS 62975", "IEC WD PAS 62975", "urn:iec:std:iec:62975::pas-stage-20.20::", "urn:pubid:iec:pas:62975:stage-wd_pas", "wd_pas", "publicly-available-specification"],
  // The Guide ladder: the two-token faces plus the DGuide/FDGuide drafts
  // (PRF Guide folds onto :fdguide like PRF onto :fdis).
  ["IEC CD Guide 104", "IEC CD Guide 104", "urn:iec:std:iec:104::guide-stage-30.00::", "urn:pubid:iec:guide:104:stage-cd_guide", "cd_guide", "guide"],
  ["IEC PWI Guide 104", "IEC PWI Guide 104", "urn:iec:std:iec:104::guide-stage-00.00::", "urn:pubid:iec:guide:104:stage-pwi_guide", "pwi_guide", "guide"],
  ["IEC NP Guide 104", "IEC NP Guide 104", "urn:iec:std:iec:104::guide-stage-10.00::", "urn:pubid:iec:guide:104:stage-np_guide", "np_guide", "guide"],
  ["IEC ANW Guide 104", "IEC ANW Guide 104", "urn:iec:std:iec:104::guide-stage-10.99::", "urn:pubid:iec:guide:104:stage-anw_guide", "anw_guide", "guide"],
  ["IEC WD Guide 104", "IEC WD Guide 104", "urn:iec:std:iec:104::guide-stage-20.20::", "urn:pubid:iec:guide:104:stage-wd_guide", "wd_guide", "guide"],
  ["IEC DGuide 104", "IEC DGuide 104", "urn:iec:std:iec:104::guide-stage-40.00::", "urn:pubid:iec:guide:104:stage-dguide", "dguide", "guide"],
  ["IEC FDGuide 104", "IEC FDGuide 104", "urn:iec:std:iec:104::guide-stage-50.00::", "urn:pubid:iec:guide:104:stage-fdguide", "fdguide", "guide"],
  ["IEC PRF Guide 104", "IEC FDGuide 104", "urn:iec:std:iec:104::guide-stage-50.00::", "urn:pubid:iec:guide:104:stage-fdguide", "fdguide", "guide"],
  // The stage token's digit run still binds the BASE's stage iteration
  // ("RFDIS" + 2 -> 60038.2), as the gem's token rule does.
  ["IEC RFDIS2 60038", "IEC FDIS 60038.2", "urn:iec:std:iec:60038::stage-50.00::", "urn:pubid:iec:is:60038:stage-fdis:iter-2", "fdis", "international-standard"],
];

for (const [input, render, urn, purn, stage, type] of parseParityRows) {
  test(`iec #191 parses the gem's spelling: ${input}`, () => {
    const impl = grammarImplementation("iec")!;
    const id = impl.parse(input) as unknown as IecIdentifier;

    assert.equal(id.constructor.polymorphicName, `pubid:iec:${type}`, input);
    assert.equal(id.toHuman(), render, input);
    assert.equal(id.toUrn(), urn, input);
    assert.equal(id.toPubidUrn(), purn, input);
    // The wire carries the folded row's code ("" for the published IS).
    assert.equal((id.toHash() as Record<string, unknown>)["stage"] ?? "", stage, input);
    // == its from_hash(to_hash) round trip.
    const back = id.fromHash(id.toHash());
    assert.ok(back.equals!(id), `from_hash(to_hash) == parse: ${input}`);
    assert.equal(back.toHuman(), render, input);
    // Re-parses its own render to the same identifier.
    assert.ok(impl.parse(id.toHuman()).equals!(id), `parse(render) == parse: ${input}`);
  });
}

test("iec #191: the ladder slots resolve back through parseUrn (gem parity)", () => {
  const impl = grammarImplementation("iec")!;
  // The gem's UrnParser answers (verified in-process at 2.0.32); each
  // slot round-trips through both engines byte-for-byte.
  const rows: [string, string][] = [
    ["urn:iec:std:iec:62048::tr-stage-30.00::", "IEC CD TR 62048"],
    ["urn:iec:std:iec:62048::tr-stage-00.00::", "IEC PWI TR 62048"],
    ["urn:iec:std:iec:62048::ts-stage-30.00::", "IEC CD TS 62048"],
    ["urn:iec:std:iec:62975::pas-stage-00.00::", "IEC PWI PAS 62975"],
    ["urn:iec:std:iec:104::guide-stage-30.00::", "IEC CD Guide 104"],
    ["urn:iec:std:iec:104::guide-stage-40.00::", "IEC DGuide 104"],
    ["urn:iec:std:iec:104::guide-stage-50.00::", "IEC FDGuide 104"],
  ];
  for (const [urn, human] of rows) {
    const rebuilt = impl.parseUrn!(urn) as unknown as IecIdentifier;
    assert.equal(rebuilt.toHuman(), human, urn);
    assert.equal(rebuilt.toUrn(), urn, urn);
  }
});

test("iec #191: the spellings the gem's grammar rejects stay rejected (gem parity)", () => {
  const impl = grammarImplementation("iec")!;
  // The gem's registry lists these abbreviations, but its COMPILED
  // grammar has no token for them — the gem rejects every one (verified
  // in-process at 2.0.32), so the TS keeps them out of the token table.
  // CAN, PCC, SPLIT, MERGED (cd row), DIS/ADIS (cdv row), DEL/PRVN (np
  // row), AWI (anw row), RPUB/TPUB/DECPUB/SPE (is row), and the
  // PROJECT_STAGES names (AFDIS, PRVDTR, TDTR, PRVDTS, TDTS, PRVDPAS,
  // DECFDIS, PRVC, PRVD, TCDV).
  const rejects = [
    "IEC CAN 60038", "IEC PCC 60038", "IEC SPLIT 60038", "IEC MERGED 60038",
    "IEC DIS 60038", "IEC ADIS 60038", "IEC DEL 60038", "IEC PRVN 60038",
    "IEC AWI 60038", "IEC RPUB 60038", "IEC TPUB 60038", "IEC DECPUB 60038",
    "IEC SPE 60038", "IEC AFDIS 60038", "IEC PRVDTR 60038", "IEC TDTR 60038",
    "IEC PRVDTS 60038", "IEC TDTS 60038", "IEC PRVDPAS 60038",
    "IEC DECFDIS 60038", "IEC PRVC 60038", "IEC PRVD 60038", "IEC TCDV 60038",
  ];
  for (const input of rejects) {
    assert.throws(() => impl.parse(input), input);
  }
});

test("iec #191: the frag-ladder spellings stay raising (recorded gem divergence)", () => {
  const impl = grammarImplementation("iec")!;
  // The frag-ladder spellings (CDFRAG, DFRAG, FDFRAG, PRF Frag, PWI
  // Frag): the gem parses them into a render-broken shape — the
  // fragment carries no base, renders "/FRAG", its official URN is
  // empty and from_hash(to_hash) != parse. There is nothing to mirror:
  //   the gem cannot round-trip its own answer. (The three unported
  // deliverable types this list used to carry — Technology Report,
  // Trend Report, White Paper — are ported by #195 below.)
  const raising = [
    "IEC CDFRAG 60050-191", "IEC DFRAG 60050-191", "IEC FDFRAG 60050-191",
    "IEC PRF Frag 60050-191", "IEC PWI Frag 60050-191",
  ];
  for (const input of raising) {
    assert.throws(() => impl.parse(input), input);
  }
});

// --- #195: the standalone deliverable types (Technology Report, Trend
// Report, White Paper) ---------------------------------------------
//
// The gem's TechnologyReport / SocietalTechnologyTrendReport /
// WhitePaper (lib/pubid/iec/identifiers/*.rb at 2.0.32): plain
// single-document types, one published typed stage each, the full
// phrase the ONLY spelling the grammar accepts. This table is the
// record: every row verified byte-for-byte against gem 2.0.32
// in-process (source checkout at the 2.0.32 tag, VERSION-checked:
// class, to_s, canonical wire hash, official URN, pubid URN, pubid-URN
// round trip + re-render). Corpus-absent (the testsuite carries no
// attested row for any of the three — only parse-error message text in
// the debt notes) — these pins ARE the record.
//
// Official-URN asymmetries mirrored from the gem (probed, not judged):
// - the type slot writes `tec`/`wp` for the published TechnologyReport
//   / WhitePaper (TYPE_SLOT_CODES) but NOTHING for the sttr — its
//   type code is not in the legacy slot list, so the slot stays empty;
// - the gem's own UrnParser cannot read those slots back (`IEC TEC
//   62674` has no grammar token): parseUrn of the emitted tec/wp URN
//   raises, and the slot-less sttr URN re-parses as the plain
//   International Standard `IEC 63090`. The pubid-scheme URN
//   (urn:pubid:iec:tr2 / :sttr / :wp) round-trips exactly, as the gem's
//   does.
const deliverableRows: [string, string, string, string, string][] = [
  // Technology Report (tec): designation, parts, date, edition,
  // language, undated, dotted sub-number, copublishers.
  ["IEC Technology Report 62674:2019", "IEC Technology Report 62674:2019", "urn:iec:std:iec:62674:2019:tec::", "urn:pubid:iec:tr2:62674:year-2019", "technology-report"],
  ["IEC Technology Report 62674", "IEC Technology Report 62674", "urn:iec:std:iec:62674::tec::", "urn:pubid:iec:tr2:62674", "technology-report"],
  ["IEC Technology Report 62674-1:2019", "IEC Technology Report 62674-1:2019", "urn:iec:std:iec:62674-1:2019:tec::", "urn:pubid:iec:tr2:62674:part-1:year-2019", "technology-report"],
  ["IEC Technology Report 62674-1-2:2019", "IEC Technology Report 62674-1-2:2019", "urn:iec:std:iec:62674-1-2:2019:tec::", "urn:pubid:iec:tr2:62674:part-1:subpart-2:year-2019", "technology-report"],
  ["IEC Technology Report 62674:2019 ED1", "IEC Technology Report 62674:2019 ED1", "urn:iec:std:iec:62674:2019:tec:ed-1:", "urn:pubid:iec:tr2:62674:year-2019:ed-1", "technology-report"],
  ["IEC Technology Report 62674 Edition 2", "IEC Technology Report 62674 ED2", "urn:iec:std:iec:62674::tec:ed-2:", "urn:pubid:iec:tr2:62674:ed-2", "technology-report"],
  ["IEC Technology Report 62674 Ed. 1", "IEC Technology Report 62674 ED1", "urn:iec:std:iec:62674::tec:ed-1:", "urn:pubid:iec:tr2:62674:ed-1", "technology-report"],
  ["IEC Technology Report 62674:2019(en)", "IEC Technology Report 62674:2019(en)", "urn:iec:std:iec:62674:2019:tec::en", "urn:pubid:iec:tr2:62674:year-2019:lang-en:f:0.langsrc-en", "technology-report"],
  ["IEC Technology Report 62674:--", "IEC Technology Report 62674:--", "urn:iec:std:iec:62674:--:tec::", "urn:pubid:iec:tr2:62674:undated-true", "technology-report"],
  ["IEC Technology Report 62674-1.2", "IEC Technology Report 62674-1.2", "urn:iec:std:iec:62674-1::tec::", "urn:pubid:iec:tr2:62674:part-1:iter-2", "technology-report"],
  ["ISO/IEC Technology Report 62674:2019", "ISO/IEC Technology Report 62674:2019", "urn:iec:std:iso-iec:62674:2019:tec::", "urn:pubid:iec:tr2:62674:pub-ISO:co-IEC:year-2019", "technology-report"],
  // Trend Report (sttr): the official-URN type slot stays EMPTY (the
  // sttr code is not in the gem's legacy slot list).
  ["IEC Trend Report 63090:2023", "IEC Trend Report 63090:2023", "urn:iec:std:iec:63090:2023:::", "urn:pubid:iec:sttr:63090:year-2023", "societal-technology-trend-report"],
  ["IEC Trend Report 63090", "IEC Trend Report 63090", "urn:iec:std:iec:63090::::", "urn:pubid:iec:sttr:63090", "societal-technology-trend-report"],
  ["IEC Trend Report 63090-1", "IEC Trend Report 63090-1", "urn:iec:std:iec:63090-1::::", "urn:pubid:iec:sttr:63090:part-1", "societal-technology-trend-report"],
  ["IEC Trend Report 63090:2023 ED1", "IEC Trend Report 63090:2023 ED1", "urn:iec:std:iec:63090:2023::ed-1:", "urn:pubid:iec:sttr:63090:year-2023:ed-1", "societal-technology-trend-report"],
  ["IEC Trend Report 63090 DB", "IEC Trend Report 63090 DB", "urn:iec:std:iec:63090::::", "urn:pubid:iec:sttr:63090:database-true", "societal-technology-trend-report"],
  ["ISO/IEC Trend Report 63090", "ISO/IEC Trend Report 63090", "urn:iec:std:iso-iec:63090::::", "urn:pubid:iec:sttr:63090:pub-ISO:co-IEC", "societal-technology-trend-report"],
  // White Paper (wp): the letter numbers ride the shared number rule
  // (the AAL / RE site examples).
  ["IEC White Paper AAL", "IEC White Paper AAL", "urn:iec:std:iec:aal::wp::", "urn:pubid:iec:wp:AAL", "white-paper"],
  ["IEC White Paper RE", "IEC White Paper RE", "urn:iec:std:iec:re::wp::", "urn:pubid:iec:wp:RE", "white-paper"],
  ["IEC White Paper AAL:2018", "IEC White Paper AAL:2018", "urn:iec:std:iec:aal:2018:wp::", "urn:pubid:iec:wp:AAL:year-2018", "white-paper"],
  ["IEC White Paper 62674:2019", "IEC White Paper 62674:2019", "urn:iec:std:iec:62674:2019:wp::", "urn:pubid:iec:wp:62674:year-2019", "white-paper"],
  ["IEC White Paper AAL-1", "IEC White Paper AAL-1", "urn:iec:std:iec:aal-1::wp::", "urn:pubid:iec:wp:AAL:part-1", "white-paper"],
  ["IEC White Paper AAL Edition 1", "IEC White Paper AAL ED1", "urn:iec:std:iec:aal::wp:ed-1:", "urn:pubid:iec:wp:AAL:ed-1", "white-paper"],
  // The exact rows the #191 reject pin used to carry — the flip itself.
  ["IEC Technology Report 2024", "IEC Technology Report 2024", "urn:iec:std:iec:2024::tec::", "urn:pubid:iec:tr2:2024", "technology-report"],
  ["IEC Trend Report 2024", "IEC Trend Report 2024", "urn:iec:std:iec:2024::::", "urn:pubid:iec:sttr:2024", "societal-technology-trend-report"],
  ["IEC White Paper 2024", "IEC White Paper 2024", "urn:iec:std:iec:2024::wp::", "urn:pubid:iec:wp:2024", "white-paper"],
];

for (const [input, render, urn, purn, type] of deliverableRows) {
  test(`iec #195 parses the deliverable face: ${input}`, () => {
    const impl = grammarImplementation("iec")!;
    const id = impl.parse(input) as unknown as IecIdentifier;

    assert.equal(id.constructor.polymorphicName, `pubid:iec:${type}`, input);
    assert.equal(id.toHuman(), render, input);
    assert.equal(id.toUrn(), urn, input);
    assert.equal(id.toPubidUrn(), purn, input);
    // Published stages serialize no stage code.
    assert.equal((id.toHash() as Record<string, unknown>)["stage"] ?? "", "", input);
    // == its from_hash(to_hash) round trip.
    const back = id.fromHash(id.toHash());
    assert.ok(back.equals!(id), `from_hash(to_hash) == parse: ${input}`);
    assert.equal(back.toHuman(), render, input);
    // Re-parses its own render to the same identifier.
    assert.ok(impl.parse(id.toHuman()).equals!(id), `parse(render) == parse: ${input}`);
    // The pubid-scheme URN round-trips (the gem's Pubid.parse_pubid_urn).
    const fromUrn = parsePubidUrn(purn) as unknown as IecIdentifier;
    assert.ok(fromUrn.equals!(id), `pubid URN round trip: ${purn}`);
    assert.equal(fromUrn.toHuman(), render, purn);
  });
}

test("iec #195: the deliverable types take the shared wrapper path (gem parity)", () => {
  const impl = grammarImplementation("iec")!;
  const rows: [string, string, string, string, string][] = [
    // VAP deliverable suffix over a Technology Report.
    ["IEC Technology Report 62674:2019 CSV", "IEC Technology Report 62674:2019 CSV", "urn:iec:std:iec:62674:2019:tec:csv:", "urn:pubid:iec:tr2:62674:year-2019:vi:vap-CSV", "vap-identifier"],
    // A consolidated amendment over a Trend Report.
    ["IEC Trend Report 63090:2023+AMD1:2024", "IEC Trend Report 63090:2023+AMD1:2024", "urn:iec:std:iec:63090:2023::::plus:amd:1:2024", "urn:pubid:iec:consol:ids-(iec:sttr:63090:year-2023),(iec:amd:1:year-2024)", "consolidated-identifier"],
    // An on-base amendment over a White Paper.
    ["IEC White Paper AAL:2018/AMD1:2019", "IEC White Paper AAL:2018/AMD1:2019", "urn:iec:std:iec:aal:2018:wp::::amd:1:2019", "urn:pubid:iec:wp:AAL:year-2018:amd:1:year-2019", "amendment"],
  ];
  for (const [input, render, urn, purn, type] of rows) {
    const id = impl.parse(input) as unknown as IecIdentifier;
    assert.equal(id.constructor.polymorphicName, `pubid:iec:${type}`, input);
    assert.equal(id.toHuman(), render, input);
    assert.equal(id.toUrn(), urn, input);
    assert.equal(id.toPubidUrn(), purn, input);
    const back = id.fromHash(id.toHash());
    assert.ok(back.equals!(id), `from_hash(to_hash) == parse: ${input}`);
  }
});

test("iec #195: the spellings the gem rejects stay rejected (gem parity)", () => {
  const impl = grammarImplementation("iec")!;
  // The gem's grammar carries no short token, no case variant and no
  // draft stage for the three deliverables — the full phrase, exact
  // case, published only (probed at 2.0.32). "IEC TR2 62674" is the
  // pre-existing TR-with-iteration-2 face, not a Technology Report.
  const rejects = [
    "IEC technology report 62674", "IEC TECHNOLOGY REPORT 62674",
    "IEC trend report 63090", "IEC TREND REPORT 63090",
    "IEC white paper AAL", "IEC WHITE PAPER AAL",
    "IEC STTR 63090", "IEC WP AAL", "IEC TEC 62674",
    "IEC DTEC 62674", "IEC CD Technology Report 62674",
    "IEC Technology Report Cyber security:2019",
    "IEC Trend Report IoT 2023",
  ];
  for (const input of rejects) {
    assert.throws(() => impl.parse(input), input);
  }
});

test("iec #195: the official-URN slots and their parse asymmetry (gem parity)", () => {
  const impl = grammarImplementation("iec")!;
  // The stage-slot form resolves by (type, lead harmonized code) — the
  // gem's UrnParser answers these (probed): tec-stage-60.00 and
  // wp-stage-60.00 rebuild the deliverable face; the emitted bare
  // `tec`/`wp` type tokens have no grammar token, so the gem cannot
  // parse its own emission back — recorded, mirrored.
  const slotRows: [string, string, string][] = [
    ["urn:iec:std:iec:62674::tec-stage-60.00::", "IEC Technology Report 62674", "pubid:iec:technology-report"],
    ["urn:iec:std:iec:aal::wp-stage-60.00::", "IEC White Paper AAL", "pubid:iec:white-paper"],
    // (The gem answers `tr-stage-60.00` the same way — the published TR
    // row's lead code — but the pre-existing TS tr/ts/pas published rows
    // carry no harmonized and predate this port; that residue is
    // deliberately untouched here.)
  ];
  for (const [urn, human, type] of slotRows) {
    const rebuilt = impl.parseUrn!(urn) as unknown as IecIdentifier;
    assert.equal(rebuilt.toHuman(), human, urn);
    assert.equal(rebuilt.constructor.polymorphicName, type, urn);
  }
  // The emitted tec/wp official URNs do NOT re-parse (the gem's own
  // UrnParser raises on them — `IEC TEC`/`IEC WP` are no grammar
  // tokens), and the slot-LESS sttr URN re-parses as the plain IS.
  assert.throws(() => impl.parseUrn!("urn:iec:std:iec:62674:2019:tec::"), "tec emission");
  assert.throws(() => impl.parseUrn!("urn:iec:std:iec:aal::wp::"), "wp emission");
  const sttr = impl.parseUrn!("urn:iec:std:iec:63090::::") as unknown as IecIdentifier;
  assert.equal(sttr.constructor.polymorphicName, "pubid:iec:international-standard");
  assert.equal(sttr.toHuman(), "IEC 63090");
});

test("iec #195: the working document keeps its own class (the wp slot split)", () => {
  const impl = grammarImplementation("iec")!;
  // "wp" is now the White Paper type code; the work-programme and
  // working-document forms construct the working-document class
  // directly (they did through the "wp" KIND_CLASSES slot before the
  // split).
  const wp = impl.parse("PWI 65-915 ED1") as unknown as IecIdentifier;
  assert.equal(wp.constructor.polymorphicName, "pubid:iec:working-document");
  assert.equal(wp.toHuman(), "PWI 65-915 ED1");
  const wd = impl.parse("1/2457/FDIS") as unknown as IecIdentifier;
  assert.equal(wd.constructor.polymorphicName, "pubid:iec:working-document");
  assert.equal(wd.toHuman(), "1/2457/FDIS");
});
