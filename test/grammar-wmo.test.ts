import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCorpus } from "../src/corpus/loader.js";
import { runFlavor } from "../src/conformance/runner.js";
import { PendingRegistry } from "../src/conformance/pending.js";
import { grammarImplementation } from "../src/flavors/index.js";
import type { Identifier } from "../src/conformance/implementation.js";

// wmo — the pubid#763 round widened (gem#768, grammar#142): 40 cases
// across the WMO-No. publication series (calendar-year editions, the
// comma citation face), the widened faces (the volume face "Volume I"
// / dotted-roman "I.1" / letter "D" printed before the edition face,
// the compound year-pair edition "2021/2018" riding one edition
// string, the status-qualified "Provisional 2026 edition", the
// "updated in 2025" tail), the new series heads (WMO/TD-No., JCOMM
// Technical Report No., GAW Report No. — the prefix law: every head
// names its publisher), the WMO-published S-100 specifications (the
// IHO lexical form, dotted editions, per the S-201-of-IALA ruling),
// the annex wrapper and the MRN URN forms; 18 aliases, 12 negatives,
// 12 debt rows.
//
// The gate runs the pubid-testsuite round (frozen at pubid 7ac315d2 /
// 2.0.49, the widening release) through the same conformance runner as
// corpus mode, vendored byte-identical under test/fixtures/
// corpus-rounds/ - the eu/arxiv fixture pattern of #214. The testsuite
// pin now carries the round (af9068b); the vendored copy stays as the
// flavor's self-contained fixture (verified identical against the pin).

const CORPUS_ROUND_DIR = new URL("../../test/fixtures/corpus-rounds", import.meta.url).pathname;

// The pubid-scheme URN hook lives on BaseIdentifier, not the
// conformance Identifier surface — the cast mirrors the existing test
// below.
const pubidUrn = (id: Identifier): string =>
  (id as unknown as { toPubidUrn(): string }).toPubidUrn();

test("every wmo corpus case passes through the grammar", () => {
  const corpus = loadCorpus(CORPUS_ROUND_DIR);
  const payloads = corpus.flavors.get("wmo")!;
  const impl = grammarImplementation("wmo")!;
  assert.ok(impl, "wmo is grammar-backed");
  const report = runFlavor("wmo", payloads, impl, new PendingRegistry());
  assert.equal(report.failures.length, 0, report.failures.slice(0, 10).join("; "));
  assert.equal(report.outcome, "pass");
  assert.equal(report.cases, payloads.cases.length);
  assert.ok(report.cases > 10);
});

// The edition face is type-driven off the ONE edition column: the
// comma citation face on a publication, the bare dotted face on an
// S-100 standard, the marker-letter-edition chain on an annex.
test("wmo renders the type-driven edition faces", () => {
  const impl = grammarImplementation("wmo")!;
  assert.deepEqual(impl.parse("WMO-No. 1364, 2025 edition").toHash(), {
    _type: "pubid:wmo:publication",
    number: "1364",
    edition: "2025",
  });
  assert.equal(impl.parse("WMO-No. 1364, 2025 edition").toHuman(),
    "WMO-No. 1364, 2025 edition");
  assert.equal(impl.parse("WMO-No. 1364, 2025 edition").toUrn(),
    "urn:mrn:wmo:pub:wmo-1364:ed2025");
  assert.deepEqual(impl.parse("S-411 1.2.1").toHash(), {
    _type: "pubid:wmo:standard",
    number: "411",
    edition: "1.2.1",
  });
  assert.equal(impl.parse("S-411 1.2.1").toUrn(), "urn:mrn:wmo:pub:s-411:ed1.2.1");
  // The cover-stack spelling normalizes to the comma citation face.
  assert.equal(impl.parse("WMO-No. 1364 2025 edition").toHuman(),
    "WMO-No. 1364, 2025 edition");
  // The compact spellings are aliases of the same identifiers.
  assert.equal(impl.parse("WMO-No. 1364:ed2025").toHuman(),
    "WMO-No. 1364, 2025 edition");
  assert.equal(impl.parse("S-411:ed1.2.1").toHuman(), "S-411 1.2.1");
});

// The annex wrapper preserves the marker case verbatim (Annex vs
// ANNEX); its edition applies to the annex itself, and the URN walks
// base, marker (lowercased) and edition.
test("wmo keeps the annex marker verbatim", () => {
  const impl = grammarImplementation("wmo")!;
  assert.deepEqual(impl.parse("S-411 Annex A").toHash(), {
    _type: "pubid:wmo:annex",
    base: { _type: "pubid:wmo:standard", number: "411" },
    annex_form: "Annex",
    letter: "A",
  });
  assert.equal(impl.parse("S-411 Annex A").toUrn(), "urn:mrn:wmo:pub:s-411:annex-a");
  // The uppercase form round-trips through the human face; its URN
  // re-renders to the attested face.
  assert.equal(impl.parse("S-411 ANNEX A").toHuman(), "S-411 ANNEX A");
  assert.equal(impl.parse("S-411 ANNEX A").toUrn(), "urn:mrn:wmo:pub:s-411:annex-a");
  // The bare form and the edition-carrying form.
  assert.equal(impl.parse("S-411 Annex").toUrn(), "urn:mrn:wmo:pub:s-411:annex");
  assert.equal(impl.parse("S-411 Annex A 1.2.0").toHuman(), "S-411 Annex A 1.2.0");
  assert.equal(impl.parse("S-411 Annex A 1.2.0").toUrn(),
    "urn:mrn:wmo:pub:s-411:annex-a:ed1.2.0");
});

// The widened publication faces (the #768 widening): the volume face
// precedes the edition face, the compound year pair rides ONE edition
// string, the status word and the updated-in year ride their own
// attributes beside it.
test("wmo renders the widened publication faces", () => {
  const impl = grammarImplementation("wmo")!;
  // The volume face: roman, dotted-roman sub-volume, letter.
  assert.deepEqual(impl.parse("WMO-No. 8, Volume I").toHash(), {
    _type: "pubid:wmo:publication",
    number: "8",
    volume: "I",
  });
  assert.deepEqual(impl.parse("WMO-No. 306, Volume I.1").toHash(), {
    _type: "pubid:wmo:publication",
    number: "306",
    volume: "I.1",
  });
  assert.deepEqual(impl.parse("WMO-No. 9, Volume D").toHash(), {
    _type: "pubid:wmo:publication",
    number: "9",
    volume: "D",
  });
  // Volume before edition when both appear.
  assert.deepEqual(impl.parse("WMO-No. 306, Volume I.1, 2020 edition").toHash(), {
    _type: "pubid:wmo:publication",
    number: "306",
    edition: "2020",
    volume: "I.1",
  });
  assert.equal(impl.parse("WMO-No. 306, Volume I.1, 2020 edition").toUrn(),
    "urn:mrn:wmo:pub:wmo-306:vol-i.1:ed2020");
  // The compound year pair: one edition string, primary year first.
  assert.deepEqual(impl.parse("WMO-No. 8, 2021/2018 edition").toHash(), {
    _type: "pubid:wmo:publication",
    number: "8",
    edition: "2021/2018",
  });
  assert.equal(impl.parse("WMO-No. 8, 2021/2018 edition").toUrn(),
    "urn:mrn:wmo:pub:wmo-8:ed2021-2018");
  // The status-qualified edition and the updated-in tail.
  assert.deepEqual(impl.parse("WMO-No. 8, Provisional 2026 edition").toHash(), {
    _type: "pubid:wmo:publication",
    number: "8",
    edition: "2026",
    edition_status: "Provisional",
  });
  assert.equal(impl.parse("WMO-No. 8, Provisional 2026 edition").toUrn(),
    "urn:mrn:wmo:pub:wmo-8:status-provisional:ed2026");
  assert.deepEqual(impl.parse("WMO-No. 1364, 2023 edition, updated in 2025").toHash(), {
    _type: "pubid:wmo:publication",
    number: "1364",
    edition: "2023",
    updated_in: "2025",
  });
  assert.equal(impl.parse("WMO-No. 1364, 2023 edition, updated in 2025").toUrn(),
    "urn:mrn:wmo:pub:wmo-1364:ed2023:updated-2025");
  // The pubid-scheme URN: the widening atoms in schema order, the year
  // pair escaped ~2F for its slash.
  assert.equal(pubidUrn(impl.parse("WMO-No. 8, 2021/2018 edition")),
    "urn:pubid:wmo:pub:8:ed-2021~2F2018");
  assert.equal(pubidUrn(impl.parse("WMO-No. 8, Provisional 2026 edition")),
    "urn:pubid:wmo:pub:8:ed-2026:status-Provisional");
  assert.equal(pubidUrn(impl.parse("WMO-No. 1364, 2023 edition, updated in 2025")),
    "urn:pubid:wmo:pub:1364:ed-2023:updated-2025");
  assert.equal(pubidUrn(impl.parse("WMO-No. 306, Volume I.1")),
    "urn:pubid:wmo:pub:306:vol-I.1");
});

// The new series heads: the model carries the short key (TD/JCOMM/GAW)
// and derives the citation face and the MRN slug from the SERIES table
// (lib/pubid/wmo/identifier.rb).
test("wmo carries the widened series heads", () => {
  const impl = grammarImplementation("wmo")!;
  assert.deepEqual(impl.parse("WMO/TD-No. 196").toHash(), {
    _type: "pubid:wmo:publication",
    number: "196",
    series: "TD",
  });
  assert.equal(impl.parse("WMO/TD-No. 196").toHuman(), "WMO/TD-No. 196");
  assert.equal(impl.parse("WMO/TD-No. 196").toUrn(), "urn:mrn:wmo:pub:wmo-td-196");
  assert.equal(pubidUrn(impl.parse("WMO/TD-No. 196")),
    "urn:pubid:wmo:pub:196:series-TD");
  assert.deepEqual(impl.parse("JCOMM Technical Report No. 14").toHash(), {
    _type: "pubid:wmo:publication",
    number: "14",
    series: "JCOMM",
  });
  assert.equal(impl.parse("JCOMM Technical Report No. 14").toUrn(),
    "urn:mrn:wmo:pub:jcomm-tr-14");
  assert.deepEqual(impl.parse("GAW Report No. 312").toHash(), {
    _type: "pubid:wmo:publication",
    number: "312",
    series: "GAW",
  });
  assert.equal(impl.parse("GAW Report No. 312").toUrn(), "urn:mrn:wmo:pub:gaw-312");
  assert.equal(pubidUrn(impl.parse("GAW Report No. 312")),
    "urn:pubid:wmo:pub:312:series-GAW");
});

// The prefix law of the widening ruling: a series head that names no
// publisher never parses (the bare TD-No. spellings, the misattributed
// IMO head, the third-party GAW citation form, the spaced cover
// variant of the TD head).
test("wmo rejects the prefix-law spellings", () => {
  const impl = grammarImplementation("wmo")!;
  assert.throws(() => impl.parse("TD-No. 1265"));
  assert.throws(() => impl.parse("TD No. 196"));
  assert.throws(() => impl.parse("IMO/TD-No. 259"));
  assert.throws(() => impl.parse("WMO/GAW Report No. 285"));
  assert.throws(() => impl.parse("WMO/TD - No. 1469"));
});

// The MRN URN ingestion rebuilds the human forms (lib/pubid/wmo/
// urn_parser.rb): the compact publication edition normalizes to the
// comma face; the caseless annex segment rebuilds as the attested
// "Annex" face; the widened slugs (the series codes, the caseless
// vol-/status- segments, the hyphenated year pair and the updated-in
// segment) re-case into the attested faces.
test("wmo ingests its MRN URNs", () => {
  const impl = grammarImplementation("wmo")!;
  assert.equal(impl.parse("urn:mrn:wmo:pub:wmo-1364").toHuman(), "WMO-No. 1364");
  assert.equal(impl.parse("urn:mrn:wmo:pub:wmo-1364:ed2025").toHuman(),
    "WMO-No. 1364, 2025 edition");
  assert.equal(impl.parse("urn:mrn:wmo:pub:s-411:ed1.2.1").toHuman(), "S-411 1.2.1");
  assert.equal(impl.parse("urn:mrn:wmo:pub:s-411:annex-a").toHuman(), "S-411 Annex A");
  assert.equal(impl.parse("urn:mrn:wmo:pub:s-411:ANNEX-a").toHuman(), "S-411 Annex A");
  // The widened series codes and segments.
  assert.equal(impl.parse("urn:mrn:wmo:pub:wmo-td-196").toHuman(), "WMO/TD-No. 196");
  assert.equal(impl.parse("urn:mrn:wmo:pub:jcomm-tr-14").toHuman(),
    "JCOMM Technical Report No. 14");
  assert.equal(impl.parse("urn:mrn:wmo:pub:gaw-312").toHuman(), "GAW Report No. 312");
  assert.equal(impl.parse("urn:mrn:wmo:pub:wmo-8:vol-i").toHuman(), "WMO-No. 8, Volume I");
  assert.equal(impl.parse("urn:mrn:wmo:pub:wmo-306:vol-i.1:ed2020").toHuman(),
    "WMO-No. 306, Volume I.1, 2020 edition");
  assert.equal(impl.parse("urn:mrn:wmo:pub:wmo-8:ed2021-2018").toHuman(),
    "WMO-No. 8, 2021/2018 edition");
  assert.equal(impl.parse("urn:mrn:wmo:pub:wmo-8:status-provisional:ed2026").toHuman(),
    "WMO-No. 8, Provisional 2026 edition");
  assert.equal(impl.parse("urn:mrn:wmo:pub:wmo-1364:ed2023:updated-2025").toHuman(),
    "WMO-No. 1364, 2023 edition, updated in 2025");
  // The pubid-scheme URN carries the type token and the edition atom.
  const id = impl.parse("S-411 1.2.1") as unknown as { toPubidUrn(): string };
  assert.equal(id.toPubidUrn(), "urn:pubid:wmo:std:411:ed-1.2.1");
  // Polymorphic round-trip: the annex hash rebuilds the composite.
  const annex = impl.parse("S-411 Annex A 1.2.0");
  const rt = (annex.constructor as unknown as { fromHash(h: Record<string, unknown>): Identifier })
    .fromHash(annex.toHash());
  assert.deepEqual(rt.toHash(), annex.toHash());
  assert.equal(rt.toHuman(), "S-411 Annex A 1.2.0");
});

test("wmo rejects non-identifiers", () => {
  const impl = grammarImplementation("wmo")!;
  // Bare "WMO" is not a marker; an edition needs digits; a dotted
  // edition needs at least one dot; the compact spelling needs a value.
  assert.throws(() => impl.parse("WMO 1364"));
  assert.throws(() => impl.parse("S411"));
  assert.throws(() => impl.parse("WMO-No. edition"));
  assert.throws(() => impl.parse("WMO-No. 1364, edition"));
  assert.throws(() => impl.parse("WMO-No. 1364:ed25"));
  assert.throws(() => impl.parse("S-411 1234"));
  assert.throws(() => impl.parse("S-411:ed"));
  // URN shape: the code segment must be a wmo- or s- code.
  assert.throws(() => impl.parse("urn:mrn:wmo:pub:"));
  assert.throws(() => impl.parse("urn:mrn:wmo:pub:x-411"));
  assert.throws(() => impl.parse("urn:mrn:wmo:pub:s-411:2020"));
});
