import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCorpus } from "../src/corpus/loader.js";
import { runFlavor } from "../src/conformance/runner.js";
import { PendingRegistry } from "../src/conformance/pending.js";
import { grammarImplementation } from "../src/flavors/index.js";

// jis — 10,555 corpus rows, the second-largest flavor, on the unified model.

const TESTSUITE_DIR =
  process.env["TESTSUITE_DIR"] ?? "../pubid-testsuite/tests";

test("every jis corpus case passes through the grammar", () => {
  const corpus = loadCorpus(TESTSUITE_DIR);
  const payloads = corpus.flavors.get("jis")!;
  const impl = grammarImplementation("jis")!;
  assert.ok(impl, "jis is grammar-backed");
  const report = runFlavor("jis", payloads, impl, new PendingRegistry());
  assert.equal(report.failures.length, 0, report.failures.slice(0, 10).join("; "));
  assert.equal(report.outcome, "pass");
  assert.equal(report.cases, payloads.cases.length);
  assert.ok(report.cases > 10000);
});

test("jis parses open-ended beyond the corpus", () => {
  const impl = grammarImplementation("jis")!;
  // Prefix-less and slash-separated spellings.
  assert.equal(impl.parse("Z 8301:2019").toHuman(), "JIS Z 8301:2019");
  assert.equal(impl.parse("JIS/Z 8301:2019").toHuman(), "JIS Z 8301:2019");
  // Full-width separators normalize to ASCII.
  assert.equal(impl.parse("JIS B 0600ｰ1：2001").toHuman(), "JIS B 0600-1:2001");
  // Bare SYMBOL keyword round-trips.
  assert.equal(impl.parse("JIS Z 8210 SYMBOL").toHuman(), "JIS Z 8210 SYMBOL");
  // Multi-level parts.
  assert.deepEqual(impl.parse("JIS B 0600-3-2-1:2001").toHash(), {
    _type: "pubid:jis:japanese-industrial-standard",
    series: "B",
    number: "0600",
    parts: ["3", "2", "1"],
    year: 2001,
  });
});

test("jis rejects non-identifiers", () => {
  const impl = grammarImplementation("jis")!;
  assert.throws(() => impl.parse("JIS"));
  assert.throws(() => impl.parse("JIS A"));
  assert.throws(() => impl.parse("JIS a 123:1999"));
});
// The WES forms relaton-jis#18 raised on (14 ids out of 104, ported by
// pubid#716): the (E)/(J) language face before the year, the WES TR and
// WES TS type tokens, and the AMENDMENT spelling that renders AMD.
// The testsuite corpus carries no rows for these yet (the WES corpus
// file holds only the five plain forms), so the parity set here is the
// one #716's body records.

const WES_PARITY_FORMS: [string, string, string][] = [
  ["WES 1112(E):2022", "WES 1112(E):2022", "pubid:jis:welding-engineering-standard"],
  ["WES 2801(E):1980", "WES 2801(E):1980", "pubid:jis:welding-engineering-standard"],
  ["WES 2805(E):2011", "WES 2805(E):2011", "pubid:jis:welding-engineering-standard"],
  ["WES 2808(E):2017", "WES 2808(E):2017", "pubid:jis:welding-engineering-standard"],
  ["WES 2815(E):2014", "WES 2815(E):2014", "pubid:jis:welding-engineering-standard"],
  ["WES 3001(E):2012", "WES 3001(E):2012", "pubid:jis:welding-engineering-standard"],
  ["WES 3003(E):1995", "WES 3003(E):1995", "pubid:jis:welding-engineering-standard"],
  ["WES 3003(E):1995/AMENDMENT 1:2025", "WES 3003(E):1995/AMD 1:2025", "pubid:jis:amendment"],
  ["WES 6206(E):1993", "WES 6206(E):1993", "pubid:jis:welding-engineering-standard"],
  ["WES 8103(E):2019", "WES 8103(E):2019", "pubid:jis:welding-engineering-standard"],
  ["WES 8107(E):2017", "WES 8107(E):2017", "pubid:jis:welding-engineering-standard"],
  ["WES TR 2032:2024", "WES TR 2032:2024", "pubid:jis:welding-engineering-technical-report"],
  ["WES TS 2816(E):2015", "WES TS 2816(E):2015", "pubid:jis:welding-engineering-technical-specification"],
  ["WES TS 2816:2015", "WES TS 2816:2015", "pubid:jis:welding-engineering-technical-specification"],
];

test("every WES parity form parses, renders as source and round-trips", () => {
  const impl = grammarImplementation("jis")!;
  for (const [input, rendered, type] of WES_PARITY_FORMS) {
    const id = impl.parse(input);
    assert.equal(id.toHuman(), rendered, `${input}: human`);
    assert.equal(id.toHash()["_type"], type, `${input}: _type`);
    const hash = id.toHash();
    const back = id.fromHash(hash);
    assert.deepEqual(back.toHash(), hash, `${input}: toHash/fromHash`);
    assert.equal(back.toHuman(), rendered, `${input}: rebuilt human`);
  }
});

test("the (E) edition is a different document", () => {
  const impl = grammarImplementation("jis")!;
  const pairs: [string, string][] = [
    ["WES 1112(E):2022", "WES 1112:2022"],
    ["WES TS 2816(E):2015", "WES TS 2816:2015"],
  ];
  for (const [english, plain] of pairs) {
    const e = impl.parse(english);
    const p = impl.parse(plain);
    assert.notDeepEqual(e.toHash(), p.toHash(), `${english} vs ${plain}`);
    assert.notEqual((e as unknown as { equals(o: unknown): boolean }).equals(p), true);
  }
  assert.equal(impl.parse("WES 1112(E):2022").toHash()["language"], "E");
  assert.equal(impl.parse("WES 1112(J):2022").toHash()["language"], "J");
  // Full-width brackets and colon.
  assert.equal(impl.parse("WES 1112\uFF08E\uFF09\uFF1A2022").toHuman(), "WES 1112(E):2022");
  // The (E) rides the amendment base.
  const amd = impl.parse("WES 3003(E):1995/AMENDMENT 1:2025");
  const base = (amd.toHash() as { base: { language: string } }).base;
  assert.equal(base.language, "E");
  // A language after the year renders where the source put it.
  assert.equal(impl.parse("WES 1112:2022(E)").toHuman(), "WES 1112:2022(E)");
  // The two positions of (E) are one document (ruby ==).
  const before = impl.parse("WES 1112(E):2022") as unknown as { equals(o: unknown): boolean };
  assert.equal(before.equals(impl.parse("WES 1112:2022(E)")), true);
  assert.notDeepEqual(
    impl.parse("WES 1112(E):2022").toHash(),
    impl.parse("WES 1112:2022(E)").toHash(),
    "the positions differ in the hash (langfirst)",
  );
  // (E) with no year still binds the language.
  assert.equal(impl.parse("WES 1112(E)").toHash()["language"], "E");
  // JIS keeps (E) after the year only.
  assert.equal(impl.parse("JIS X 0208:1997(E)").toHuman(), "JIS X 0208:1997(E)");
  assert.throws(() => impl.parse("JIS X 0208(E):1997"));
  assert.throws(() => impl.parse("WES 1112(E):2022(E)"));
});

test("WES TR and WES TS are types of their own", () => {
  const impl = grammarImplementation("jis")!;
  const report = impl.parse("WES TR 2032:2024");
  for (const other of ["WES 2032:2024", "JIS TR Z 2032:2024", "TR Z 2032:2024", "WES TS 2032:2024"]) {
    assert.notEqual(
      (report as unknown as { equals(o: unknown): boolean }).equals(impl.parse(other)),
      true,
      `WES TR 2032:2024 is not ${other}`,
    );
  }
  assert.equal(report.toHash()["_type"], "pubid:jis:welding-engineering-technical-report");
  assert.equal(impl.parse("WES TS 2816:2015").toHash()["_type"], "pubid:jis:welding-engineering-technical-specification");
  assert.equal(impl.parse("WES TR 2032-1:2024").toHuman(), "WES TR 2032-1:2024");
  assert.equal(report.toUrn() as string, "urn:jis:WES TR 2032:2024");
  assert.throws(() => impl.parse("TR WES 2032"));
});

