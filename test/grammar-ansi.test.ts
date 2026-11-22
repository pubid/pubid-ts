import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCorpus } from "../src/corpus/loader.js";
import { runFlavor } from "../src/conformance/runner.js";
import { PendingRegistry } from "../src/conformance/pending.js";
import { grammarImplementation } from "../src/flavors/index.js";
import type { Identifier } from "../src/conformance/implementation.js";

// ansi — the relaton#45 round: 196 corpus rows across the number shapes
// (C37.06.1, N323A, 802.1b-1995), the co-publisher wave (any uppercase
// developer acronym), the dash forms (date_separator, number_separator,
// the in-number dash year) and the TIA revision.
//
// The gate runs the pubid-testsuite round (PR #118, frozen at pubid
// 0f7ba38b / 2.0.48) through the same conformance runner as corpus
// mode. The round is vendored byte-identical under
// test/fixtures/corpus-rounds/ because the pinned testsuite ref
// (.github/pins.yaml) predates it — the eu/arxiv fixture pattern of
// #214; the vendored copy re-syncs when the pin moves past the round.

const CORPUS_ROUND_DIR = new URL("../../test/fixtures/corpus-rounds", import.meta.url).pathname;

test("every ansi corpus case passes through the grammar", () => {
  const corpus = loadCorpus(CORPUS_ROUND_DIR);
  const payloads = corpus.flavors.get("ansi")!;
  const impl = grammarImplementation("ansi")!;
  assert.ok(impl, "ansi is grammar-backed");
  const report = runFlavor("ansi", payloads, impl, new PendingRegistry());
  assert.equal(report.failures.length, 0, report.failures.slice(0, 10).join("; "));
  assert.equal(report.outcome, "pass");
  assert.equal(report.cases, payloads.cases.length);
  assert.ok(report.cases > 190);
});

// relaton#45: a trailing "-" + 4 digits is the publication year, not a
// part — rendered back with its dash (date_separator), while the colon
// spelling ("ANSI/ISO 9899:1990") renders with its colon.
test("ansi classifies the dash year as the date", () => {
  const impl = grammarImplementation("ansi")!;
  assert.deepEqual(impl.parse("ANSI 802.3-2012").toHash(), {
    _type: "pubid:ansi:standard",
    number: "802.3",
    year: "2012",
    publisher: { body: "ANSI" },
    date_separator: "-",
  });
  assert.equal(impl.parse("ANSI 802.3-2012").toUrn(), "urn:ansi:802.3:2012");
  // The part of "ANSI X9.8-1:2007" stays a part: a ":YYYY" follows.
  assert.deepEqual(impl.parse("ANSI X9.8-1:2007").toHash(), {
    _type: "pubid:ansi:standard",
    number: "X9.8",
    part: "1",
    year: "2007",
    publisher: { body: "ANSI" },
  });
  assert.equal(impl.parse("ANSI X9.8-1:2007").toUrn(), "urn:ansi:X9.8:-1:2007");
  // A third dash group is always the year ("ANSI/ISA-61511-1-2018").
  assert.deepEqual(impl.parse("ANSI/ISA-61511-1-2018").toHash(), {
    _type: "pubid:ansi:standard",
    number: "61511",
    part: "1",
    year: "2018",
    publisher: { body: "ANSI" },
    copublishers: [{ body: "ISA" }],
    date_separator: "-",
    number_separator: "-",
  });
  // A revision follows the part, so "568-2009-D" keeps 2009 as a part.
  assert.deepEqual(impl.parse("ANSI X9-2009-D").toHash(), {
    _type: "pubid:ansi:standard",
    number: "X9",
    part: "2009",
    revision: "D",
    publisher: { body: "ANSI" },
  });
});

// Any uppercase developer acronym co-publishes (ASHRAE, UL, NISO,
// INCITS, HL7 ...); the publisher group joins the URN namespace with
// dashes, lowercased.
test("ansi co-publishes any uppercase developer acronym", () => {
  const impl = grammarImplementation("ansi")!;
  assert.equal(impl.parse("ANSI/NISO Z39.88-2004").toUrn(),
    "urn:ansi-niso:Z39.88:2004");
  assert.equal(impl.parse("ANSI/ASHRAE/IES 90.1-2019").toHuman(),
    "ANSI/ASHRAE/IES 90.1-2019");
  assert.equal(impl.parse("ANSI/AAMI ST79:2017").toUrn(),
    "urn:ansi-aami:ST79:2017");
  // Mixed acronym+digit bodies ride the same rule.
  assert.equal(impl.parse("ANSI/ASC X9.24-2002").toHuman(),
    "ANSI/ASC X9.24-2002");
});

// The revision letter names a different document: it is identity, it
// renders after the part, and the URN keeps it ("rev-D").
test("ansi keeps the revision letter", () => {
  const impl = grammarImplementation("ansi")!;
  assert.deepEqual(impl.parse("ANSI/TIA-568.2-D").toHash(), {
    _type: "pubid:ansi:standard",
    number: "568.2",
    publisher: { body: "ANSI" },
    copublishers: [{ body: "TIA" }],
    number_separator: "-",
    revision: "D",
  });
  assert.equal(impl.parse("ANSI/TIA-568.2-D").toUrn(), "urn:ansi-tia:568.2:rev-D");
  assert.equal(impl.parse("ANSI/TIA-568.2-D").toHuman(), "ANSI/TIA-568.2-D");
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
  // The dash year reclassifies on a digits form too.
  const dotted = impl.parse("ANSI 802.1b-1995");
  assert.equal(dotted.toHuman(), "ANSI 802.1b-1995");
  assert.equal((dotted.toHash() as Record<string, unknown>)["year"], "1995");
  // Multi-dot letter-prefix forms.
  assert.equal(impl.parse("ANSI C57.12.10-1988").toHuman(),
    "ANSI C57.12.10-1988");
  // The separators are spelling facets: `==` skips them, but the hash
  // keeps them, and fromHash round-trips the whole face.
  const id = impl.parse("ANSI/ISA-5.1-2009");
  const rt = (id.constructor as unknown as { fromHash(h: Record<string, unknown>): Identifier })
    .fromHash(id.toHash());
  assert.deepEqual(rt.toHash(), id.toHash());
  assert.equal(rt.toHuman(), "ANSI/ISA-5.1-2009");
  assert.equal(rt.equals?.(id), true);
});

test("ansi rejects non-identifiers", () => {
  const impl = grammarImplementation("ansi")!;
  assert.throws(() => impl.parse("ANSI"));
  assert.throws(() => impl.parse("ANSI/ 802.3"));
  assert.throws(() => impl.parse("ANSI X3.4:20"));
  assert.throws(() => impl.parse("ISO 9899"));
  assert.throws(() => impl.parse("ANSI/ul 94-2023"));
  // A revision letter is ONE uppercase letter, not the start of a word.
  assert.throws(() => impl.parse("ANSI/TIA-568.2-DE"));
  // The dash year cannot double as a second date.
  assert.throws(() => impl.parse("ANSI X9.8-1-2007:2009"));
});
