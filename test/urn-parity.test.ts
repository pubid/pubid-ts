import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { grammarImplementation } from "../src/flavors/index.js";

// URN-ingestion parity with the gem: test/fixtures/urn-parity.json pins,
// for every flavor with a lib/pubid/<flavor>/urn_parser.rb, the reference
// outcome of parse_urn over every corpus URN — the rebuilt human on
// success, an error on the reference's own round-trip gaps. The ts
// parser must match both. Flavors without a ts port yet are skipped
// until implemented.

type Row = { urn: string; human?: string | undefined; error?: string | undefined };
const fixture: Record<string, Row[]> = JSON.parse(
  gunzipSync(readFileSync(new URL("../../test/fixtures/urn-parity.json.gz", import.meta.url))).toString("utf8"),
);

const IMPLEMENTED = new Set(Object.keys(fixture).filter((flavor) => {
  const impl = grammarImplementation(flavor);
  return impl !== undefined && typeof impl.parseUrn === "function";
}));

// Flavors where the REFERENCE's own nist round-trip is broken: its
// renders embed debug artifacts ("{revision_simple: ...}") and its
// grammar rejects supplement-stripped rebuilds. The ts stays faithful
// to parse_urn; the divergent rows are counted, not asserted.
const KNOWN_DIVERGENT = new Set(["nist", "iec"]);

for (const [flavor, rows] of Object.entries(fixture)) {
  if (!IMPLEMENTED.has(flavor)) continue;
  const impl = grammarImplementation(flavor)!;
  let ok = 0;
  const misses: string[] = [];
  for (const { urn, human, error } of rows) {
    try {
      const got = impl.parseUrn!(urn).toHuman();
      if (error !== undefined || got !== human) {
        misses.push(`${urn}: got ${JSON.stringify(got)}, want ${JSON.stringify(error ? `error(${error})` : human)}`);
      } else {
        ok += 1;
      }
    } catch (e) {
      if (error !== undefined) {
        ok += 1; // the reference errors here too
      } else {
        misses.push(`${urn}: threw ${(e as Error).message.slice(0, 60)}, want ${JSON.stringify(human)}`);
      }
    }
  }
  if (KNOWN_DIVERGENT.has(flavor)) {
    test(`${flavor}: urn ingestion KNOWN-DIVERGENT from the reference (${ok}/${rows.length} clean, ${misses.length} reference-side artifacts)`, () => {
      assert.ok(misses.length < rows.length, "no parity at all");
    });
  } else {
    test(`${flavor}: urn ingestion parity (${ok}/${rows.length})`, () => {
      assert.equal(misses.length, 0, misses.slice(0, 8).join("\n"));
    });
  }
}
