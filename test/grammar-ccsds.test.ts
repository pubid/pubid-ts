import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCorpus } from "../src/corpus/loader.js";
import { runFlavor } from "../src/conformance/runner.js";
import { PendingRegistry } from "../src/conformance/pending.js";
import { grammarImplementation } from "../src/flavors/index.js";

// ccsds — 490 corpus rows (449 base + 41 corrigendum): the
// published-standard family, Corrigendum wrapping its base.

const TESTSUITE_DIR =
  process.env["TESTSUITE_DIR"] ?? "../pubid-testsuite/tests";

test("every ccsds corpus case passes through the grammar", () => {
  const corpus = loadCorpus(TESTSUITE_DIR);
  const payloads = corpus.flavors.get("ccsds")!;
  const impl = grammarImplementation("ccsds")!;
  assert.ok(impl, "ccsds is grammar-backed");
  const report = runFlavor("ccsds", payloads, impl, new PendingRegistry());
  assert.equal(report.failures.length, 0, report.failures.slice(0, 10).join("; "));
  assert.equal(report.outcome, "pass");
  assert.equal(report.cases, payloads.cases.length);
  assert.ok(report.cases > 480);
});

test("ccsds parses open-ended beyond the corpus", () => {
  const impl = grammarImplementation("ccsds")!;

  // The bare base, with and without the -S suffix.
  assert.deepEqual(impl.parse("CCSDS 120.0-G-4").toHash(), {
    _type: "pubid:ccsds:base",
    number: "120",
    part: "0",
    edition: "4",
    type: "G",
  });
  assert.equal(impl.parse("CCSDS 120.0-G-4").toUrn(), "urn:ccsds:120.0-G-4");
  assert.deepEqual(impl.parse("CCSDS 100.0-G-1-S").toHash(), {
    _type: "pubid:ccsds:base",
    number: "100",
    part: "0",
    edition: "1",
    type: "G",
    suffix: "S",
  });

  // The corrigendum: number rides the supplement, the base nests.
  const cor = impl.parse("CCSDS 121.0-B-1-S Cor. 1");
  assert.deepEqual(cor.toHash(), {
    _type: "pubid:ccsds:corrigendum",
    number: "1",
    base: {
      _type: "pubid:ccsds:base",
      number: "121",
      part: "0",
      edition: "1",
      type: "B",
      suffix: "S",
    },
  });
  assert.equal(cor.toHuman(), "CCSDS 121.0-B-1-S Cor. 1");
  assert.equal(cor.toUrn(), "urn:ccsds:121.0-B-1-S:cor.1");

  // The corpus-external part-less spelling still parses.
  assert.equal(impl.parse("CCSDS 650.0-G-2").toHuman(), "CCSDS 650.0-G-2");

  // The language face: hash + human parity; to_urn is where the
  // REFERENCE ITSELF raises (`language&.code` on a plain String,
  // NoMethodError — the corpus exporter omits these URNs for exactly
  // this reason), so the port mirrors the raise instead of inventing a
  // spelling the reference never emits.
  const lang = impl.parse("CCSDS 551.1-O-2 - Russian Translated");
  assert.deepEqual(lang.toHash(), {
    _type: "pubid:ccsds:base",
    number: "551",
    part: "1",
    edition: "2",
    type: "O",
    language: "Russian",
  });
  assert.equal(lang.toHuman(), "CCSDS 551.1-O-2 - Russian Translated");
  assert.throws(() => lang.toUrn(), /reference raises on a language face/);

  // data/ccsds/update_codes.yaml: the "Corrigendum" spelling normalizes
  // to the canonical "Cor." before the parse.
  assert.equal(
    impl.parse("CCSDS 320.0-B-1-S Corrigendum 1").toHuman(),
    "CCSDS 320.0-B-1-S Cor. 1",
  );

  // The URN parser entry (lib/pubid/ccsds/urn_parser.rb): the body is
  // the full suffix; the cor-supplemented forms are rejected by the
  // reference's text grammar — the fixture-pinned gap the registry
  // mirrors (src/urn/parsers.ts).
  assert.equal(impl.parse("urn:ccsds:100.0-G-1-S").toHuman(), "CCSDS 100.0-G-1-S");
  assert.throws(() => impl.parse("urn:ccsds:121.0-B-1-S:cor.1"), /rejected by the reference/);
  // An empty body (or any non-identifier body) fails at the artifact.
  assert.throws(() => impl.parse("urn:ccsds:"), /artifact rejected/);
  assert.throws(() => impl.parse("urn:ccsds:120 0-G-4"), /artifact rejected/);

  // fromHash round-trips both shapes, nested base included.
  const rebuilt = impl.parse("CCSDS 121.0-B-1-S Cor. 1").fromHash(cor.toHash());
  assert.equal(rebuilt.toHash()["base"] && JSON.stringify(rebuilt.toHash()), JSON.stringify(cor.toHash()));

  // The pubid-scheme URN (the lossless form) matches the reference
  // byte-for-byte on both shapes.
  assert.equal(
    (impl.parse("CCSDS 120.0-G-4") as unknown as { toPubidUrn(): string }).toPubidUrn(),
    "urn:pubid:ccsds:base:120:type-G:part-0:ed-4",
  );
  assert.equal(
    (cor as unknown as { toPubidUrn(): string }).toPubidUrn(),
    "urn:pubid:ccsds:base:121:type-B:part-0:ed-1:suffix-S:cor:1",
  );
});
