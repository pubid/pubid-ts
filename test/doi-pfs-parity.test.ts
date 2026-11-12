import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { ParseFailed } from "../src/grammar/engine.js";
import { grammarImplementation } from "../src/flavors/index.js";
import { DoiIdentifier } from "../src/flavors/doi/index.js";
import { DoiPfsIdentifier } from "../src/flavors/doi_pfs/index.js";
import { resolveType } from "../src/model/identifier.js";
import type { BaseIdentifier } from "../src/model/identifier.js";
import { flavorSchema } from "../src/pubid-urn/index.js";

// The doi_pfs parity gate (pubid/pubid#706): the PFS-compiled TS flavor
// and the coded TS doi flavor must agree BYTE-FOR-BYTE over the shared
// conformance set — the exact inventory the Ruby harness
// (spec/pubid/doi_pfs/parity_spec.rb) exports, together with the
// reference outputs both Ruby flavors produce for it. One conformance
// set, both engines. Drift is a defect in the definition, the compiler
// artifact or this port — never a reason to relax an expectation here.

interface ParityFixture {
  provenance: {
    generator: string;
    source_spec: string;
    pubid_ref: string;
    notes: string;
  };
  positives: {
    input: string;
    ruby: Record<"doi" | "doi_pfs", {
      to_s: string;
      to_hash: Record<string, unknown>;
      to_urn: string;
      to_mr_string: string;
      to_pubid_urn: string;
    }>;
    agree: boolean;
  }[];
  negatives: {
    input: string;
    ruby: Record<"doi" | "doi_pfs", string>;
  }[];
}

const fixture: ParityFixture = JSON.parse(
  readFileSync(new URL("../../test/fixtures/doi-pfs-parity.json", import.meta.url), "utf8"),
);

const coded = grammarImplementation("doi")!;
const pfs = grammarImplementation("doi_pfs")!;

// The TS methods the parity covers; to_mr_string has no TS counterpart
// yet (see the fixture's provenance.notes — the Ruby column is recorded
// there so the shared set stays complete for both engines).
const METHODS = ["to_s", "to_hash", "to_urn", "to_pubid_urn"] as const;
const read = (id: BaseIdentifier, method: (typeof METHODS)[number]): unknown => {
  switch (method) {
    case "to_s": return id.toString();
    case "to_hash": return id.toHash();
    case "to_urn": return id.toUrn();
    case "to_pubid_urn": return id.toPubidUrn();
  }
};

for (const row of fixture.positives) {
  test(`[${row.input}] both TS flavors agree byte-for-byte, and with the Ruby reference`, () => {
    assert.ok(row.agree, "the fixture itself must record ruby-doi == ruby-doi_pfs");

    const codedId = coded.parse(row.input) as BaseIdentifier;
    const pfsId = pfs.parse(row.input) as BaseIdentifier;

    // Class-level semantics: distinct classes, same declared shape.
    assert.ok(codedId instanceof DoiIdentifier);
    assert.ok(pfsId instanceof DoiPfsIdentifier);
    assert.ok(!(pfsId instanceof DoiIdentifier));

    for (const method of METHODS) {
      const codedOut = read(codedId, method);
      const pfsOut = read(pfsId, method);
      assert.deepEqual(pfsOut, codedOut, `doi_pfs ${method} must equal the coded flavor's`);
      // Cross-engine: the TS output equals what BOTH Ruby flavors
      // recorded in the shared set (they agree — asserted above).
      assert.deepEqual(pfsOut, row.ruby.doi[method], `TS ${method} must equal the Ruby reference's`);
    }
  });

  test(`[${row.input}] round-trips through its own fromHash`, () => {
    const pfsId = pfs.parse(row.input) as DoiPfsIdentifier;
    const rebuilt = DoiPfsIdentifier.fromHash(pfsId.toHash());
    assert.ok(rebuilt instanceof DoiPfsIdentifier,
      "the alias's own fromHash must route the scheme tag back to the compiled class");
    assert.deepEqual(rebuilt.toHash(), pfsId.toHash());
  });
}

for (const row of fixture.negatives) {
  test(`[${row.input}] both TS flavors reject like the Ruby flavors`, () => {
    assert.equal(row.ruby.doi, "rejected");
    assert.equal(row.ruby.doi_pfs, "rejected");
    assert.throws(() => coded.parse(row.input), ParseFailed);
    assert.throws(() => pfs.parse(row.input), ParseFailed);
  });
}

test("coexistence: the coded flavor keeps the global resolution and the routing", () => {
  // One scheme, one _type, one global resolution: the scheme tag still
  // resolves the CODED class everywhere global.
  assert.equal(resolveType("pubid:doi:resource"), DoiIdentifier);
  assert.ok(coded.parse("doi:10.1000/182") instanceof DoiIdentifier);
  // ...while the alias's own fromHash routes the same tag locally.
  const rebuilt = DoiPfsIdentifier.fromHash({ _type: "pubid:doi:resource", prefix: "10.1000", suffix: "182" });
  assert.ok(rebuilt instanceof DoiPfsIdentifier);
});

test("the compiled flavor joins the pubid-urn schema registry under its own key", () => {
  // Registered under the FLAVOR key ("doi_pfs") — never under "doi":
  // the identifiers carry the scheme's canonical wire tag, so their
  // pubid URNs encode through the coded flavor's schema.
  assert.ok(flavorSchema("doi_pfs"), "doi_pfs schema must be registered");
  assert.ok(flavorSchema("doi"), "the coded schema must be untouched");
});
