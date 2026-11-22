import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCorpus } from "../src/corpus/loader.js";
import { runFlavor } from "../src/conformance/runner.js";
import { PendingRegistry } from "../src/conformance/pending.js";
import { grammarImplementation } from "../src/flavors/index.js";
import type { Identifier } from "../src/conformance/implementation.js";

// wmo — the pubid#763 round: 11 cases across the WMO-No. publication
// series (calendar-year editions, the comma citation face), the
// WMO-published S-100 specifications (the IHO lexical form, dotted
// editions, per the S-201-of-IALA ruling), the annex wrapper and the
// MRN URN forms; 9 aliases, 7 negatives, 7 debt rows.
//
// The gate runs the pubid-testsuite round (PR #119, frozen at pubid
// 0f7ba38b / 2.0.48) through the same conformance runner as corpus
// mode, vendored byte-identical under test/fixtures/corpus-rounds/ -
// the eu/arxiv fixture pattern of #214; the pinned testsuite ref
// (.github/pins.yaml) predates the round.

const CORPUS_ROUND_DIR = new URL("../../test/fixtures/corpus-rounds", import.meta.url).pathname;

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

// The MRN URN ingestion rebuilds the human forms (lib/pubid/wmo/
// urn_parser.rb): the compact publication edition normalizes to the
// comma face; the caseless annex segment rebuilds as the attested
// "Annex" face.
test("wmo ingests its MRN URNs", () => {
  const impl = grammarImplementation("wmo")!;
  assert.equal(impl.parse("urn:mrn:wmo:pub:wmo-1364").toHuman(), "WMO-No. 1364");
  assert.equal(impl.parse("urn:mrn:wmo:pub:wmo-1364:ed2025").toHuman(),
    "WMO-No. 1364, 2025 edition");
  assert.equal(impl.parse("urn:mrn:wmo:pub:s-411:ed1.2.1").toHuman(), "S-411 1.2.1");
  assert.equal(impl.parse("urn:mrn:wmo:pub:s-411:annex-a").toHuman(), "S-411 Annex A");
  assert.equal(impl.parse("urn:mrn:wmo:pub:s-411:ANNEX-a").toHuman(), "S-411 Annex A");
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
