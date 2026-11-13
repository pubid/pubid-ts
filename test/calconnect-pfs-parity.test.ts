import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { ParseFailed } from "../src/grammar/engine.js";
import { grammarImplementation } from "../src/flavors/index.js";
import { CalconnectIdentifier } from "../src/flavors/calconnect/index.js";
import { CalconnectPfsIdentifier } from "../src/flavors/calconnect_pfs/index.js";
import { resolveType } from "../src/model/identifier.js";
import type { BaseIdentifier } from "../src/model/identifier.js";
import { flavorSchema } from "../src/pubid-urn/index.js";

// The calconnect_pfs parity gate (pubid/pubid#706 §8): the PFS-compiled
// TS flavor and the coded TS calconnect flavor must agree BYTE-FOR-BYTE
// over the shared conformance set — the exact inventory the Ruby harness
// (spec/pubid/calconnect_pfs/parity_spec.rb) consumes, together with the
// reference outputs both Ruby flavors produce for it. One conformance
// set, both engines. Drift is a defect in the definition, the compiler
// artifact or this port — never a reason to relax an expectation here.

interface CorpusRow {
  id: string;
  input: string;
  canonical_hash: Record<string, unknown>;
  aliases: string[];
  ruby: Record<"calconnect" | "calconnect_pfs", {
    to_s: string;
    to_hash: Record<string, unknown>;
    to_urn: string;
    to_mr_string: string;
    to_pubid_urn: string;
  }>;
  agree: boolean;
}

interface FaceRow {
  input: string;
  ruby: Record<"calconnect" | "calconnect_pfs", {
    to_s: string;
    to_s_without_publisher: string;
    to_hash: Record<string, unknown>;
  }>;
  agree: boolean;
}

interface ParityFixture {
  provenance: {
    generator: string;
    source_spec: string;
    pubid_ref: string;
    testsuite_ref: string;
    notes: string;
  };
  corpus: CorpusRow[];
  faces: FaceRow[];
  negatives: {
    id: string;
    input: string;
    ruby: Record<"calconnect" | "calconnect_pfs", string>;
  }[];
}

const fixture: ParityFixture = JSON.parse(
  readFileSync(
    new URL("../../test/fixtures/calconnect-pfs-parity.json", import.meta.url),
    "utf8",
  ),
);

const coded = grammarImplementation("calconnect")!;
const pfs = grammarImplementation("calconnect_pfs")!;

// The TS methods the parity covers; to_mr_string and
// to_s(with_publisher:) have no TS counterpart yet (see the fixture's
// provenance.notes — the Ruby columns are recorded there so the shared
// set stays complete for both engines).
const METHODS = ["to_s", "to_hash", "to_urn", "to_pubid_urn"] as const;
const read = (id: BaseIdentifier, method: (typeof METHODS)[number]): unknown => {
  switch (method) {
    case "to_s": return id.toString();
    case "to_hash": return id.toHash();
    case "to_urn": return id.toUrn();
    case "to_pubid_urn": return id.toPubidUrn();
  }
};

for (const row of fixture.corpus) {
  test(`[${row.id}] both TS flavors agree byte-for-byte, and with the Ruby reference (${row.input})`, () => {
    assert.ok(row.agree, "the fixture itself must record ruby-calconnect == ruby-calconnect_pfs");

    const codedId = coded.parse(row.input) as BaseIdentifier;
    const pfsId = pfs.parse(row.input) as BaseIdentifier;

    // Class-level semantics: distinct classes, same declared shape.
    assert.ok(codedId instanceof CalconnectIdentifier);
    assert.ok(pfsId instanceof CalconnectPfsIdentifier);
    assert.ok(!(pfsId instanceof CalconnectIdentifier));

    for (const method of METHODS) {
      const codedOut = read(codedId, method);
      const pfsOut = read(pfsId, method);
      assert.deepEqual(pfsOut, codedOut, `calconnect_pfs ${method} must equal the coded flavor's`);
      // Cross-engine: the TS output equals what BOTH Ruby flavors
      // recorded in the shared set (they agree — asserted above).
      assert.deepEqual(pfsOut, row.ruby.calconnect[method], `TS ${method} must equal the Ruby reference's`);
    }

    // The corpus row's own canonical hash: both flavors' to_hash.
    assert.deepEqual(pfsId.toHash(), row.canonical_hash);
  });

  test(`[${row.id}] round-trips through its own fromHash`, () => {
    const pfsId = pfs.parse(row.input) as CalconnectPfsIdentifier;
    const rebuilt = CalconnectPfsIdentifier.fromHash(pfsId.toHash());
    assert.ok(rebuilt instanceof CalconnectPfsIdentifier,
      "the alias's own fromHash must route the scheme tag back to the compiled class");
    assert.deepEqual(rebuilt.toHash(), pfsId.toHash());
  });

  for (const spelling of row.aliases) {
    test(`[${row.id}] normalizes the alias ${spelling} like the coded flavor`, () => {
      assert.equal(pfs.parse(spelling).toString(), row.input);
      assert.equal(coded.parse(spelling).toString(), row.input);
    });
  }
}

for (const face of fixture.faces) {
  test(`[${face.input}] the constructed face matches the coded flavor, and the Ruby reference`, () => {
    assert.ok(face.agree, "the fixture itself must record ruby-calconnect == ruby-calconnect_pfs");

    const codedId = coded.parse(face.input) as BaseIdentifier;
    const pfsId = pfs.parse(face.input) as BaseIdentifier;
    assert.deepEqual(pfsId.toString(), codedId.toString());
    assert.deepEqual(pfsId.toString(), face.ruby.calconnect.to_s);
    // The internal-form cut has no TS counterpart yet; the canonical
    // to_hash still matches both engines.
    assert.deepEqual(pfsId.toHash(), codedId.toHash());
    assert.deepEqual(pfsId.toHash(), face.ruby.calconnect.to_hash);
  });
}

for (const row of fixture.negatives) {
  test(`[${row.id}] both TS flavors reject ${row.input} like the Ruby flavors`, () => {
    assert.equal(row.ruby.calconnect, "rejected");
    assert.equal(row.ruby.calconnect_pfs, "rejected");
    assert.throws(() => coded.parse(row.input), ParseFailed);
    assert.throws(() => pfs.parse(row.input), ParseFailed);
  });
}

test("coexistence: the coded flavor keeps the global resolution and the routing", () => {
  // One scheme, one _type, one global resolution: the scheme tag still
  // resolves the CODED class everywhere global.
  assert.equal(resolveType("pubid:calconnect:standard"), CalconnectIdentifier);
  assert.ok(coded.parse("CC 18011:2018") instanceof CalconnectIdentifier);
  // ...while the alias's own fromHash routes the same tag locally.
  const rebuilt = CalconnectPfsIdentifier.fromHash({
    _type: "pubid:calconnect:standard",
    number: "18011",
    year: "2018",
  });
  assert.ok(rebuilt instanceof CalconnectPfsIdentifier);
});

test("the compiled flavor joins the pubid-urn schema registry under its own key", () => {
  // Registered under the FLAVOR key ("calconnect_pfs") — never under
  // "calconnect": the identifiers carry the scheme's canonical wire tag,
  // so their pubid URNs encode through the coded flavor's schema.
  assert.ok(flavorSchema("calconnect_pfs"), "calconnect_pfs schema must be registered");
  assert.ok(flavorSchema("calconnect"), "the coded schema must be untouched");
});
