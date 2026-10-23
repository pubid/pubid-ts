import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { BaseIdentifier } from "../src/model/identifier.js";
import { subsetMatch } from "../src/model/subset-match.js";
import { isoGrammarImplementation } from "../src/flavors/iso/index.js";
import { iecGrammarImplementation } from "../src/flavors/iec/index.js";

// The TS executor for relaton's shared retrieval conformance pack
// (relaton/conformance/retrieval/): the same index rows and expectations the
// Ruby executor (spec/conformance/retrieval_spec.rb) runs — the retrieval
// contract executes identically in both stacks. Point RETRIEVAL_FIXTURE_DIR
// at a relaton/relaton checkout; skipped when the fixture is absent so the
// suite stays green without a sibling clone.
const FIXTURE_DIR =
  process.env["RETRIEVAL_FIXTURE_DIR"] ??
  path.resolve(import.meta.dirname, "../../../../relaton/relaton/conformance/retrieval");

const iso = isoGrammarImplementation();
const iec = iecGrammarImplementation();

if (existsSync(path.join(FIXTURE_DIR, "index-v2.yaml"))) {
  // The published fixture uses Psych symbol keys (":id"/":file").
  const rows = (
    parseYaml(readFileSync(path.join(FIXTURE_DIR, "index-v2.yaml"), "utf8")) as Record<
      string,
      unknown
    >[]
  ).map((r) => ({
    file: String(r[":file"] ?? r["file"]),
    obj: BaseIdentifier.fromHash((r[":id"] ?? r["id"]) as Record<string, unknown>),
  }));

  const cases = (
    parseYaml(readFileSync(path.join(FIXTURE_DIR, "expectations.yaml"), "utf8")) as {
      cases: { name: string; query: string; family?: boolean; expect: string[] }[];
    }
  ).cases;

  // Ruby family(): rows whose identifier's ROOT matches the reference's —
  // walk the wrapper (base) chain to the base document, then compare the
  // root's type and number.
  function rootKey(id: BaseIdentifier): string {
    const attrs = (x: BaseIdentifier) => x as unknown as Record<string, unknown>;
    let cur = attrs(id);
    while (cur["base"] instanceof BaseIdentifier) {
      cur = attrs(cur["base"] as BaseIdentifier);
    }
    const ctor = cur["constructor"] as unknown as { polymorphicName: string };
    return `${ctor.polymorphicName}:${String(cur["number"])}`;
  }

  for (const c of cases.filter((x) => x.family)) {
    test(`retrieval fixture (family): ${c.name}`, () => {
      const impl = c.query.startsWith("IEC") ? iec : iso;
      const ref = BaseIdentifier.fromHash(impl.parse(c.query).toHash());
      const key = rootKey(ref);
      const matched = rows
        .filter((r) => rootKey(r.obj) === key)
        .map((r) => r.file)
        .sort();
      assert.deepEqual(matched, [...c.expect].sort());
    });
  }

  for (const c of cases.filter((x) => !x.family)) {
    test(`retrieval fixture: ${c.name}`, () => {
      const impl = c.query.startsWith("IEC") ? iec : iso;
      // Canonicalize the query into the model layer through its own hash.
      const ref = BaseIdentifier.fromHash(impl.parse(c.query).toHash());
      const matched = rows
        .filter((r) => subsetMatch(ref, r.obj))
        .map((r) => r.file)
        .sort();
      assert.deepEqual(matched, [...c.expect].sort());
    });
  }
} else {
  test("retrieval fixture pack present (RETRIEVAL_FIXTURE_DIR)", (t) => {
    t.skip(`no fixture at ${FIXTURE_DIR} — set RETRIEVAL_FIXTURE_DIR to a relaton/relaton checkout`);
  });
}
