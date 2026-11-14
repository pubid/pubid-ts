import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { test } from "node:test";
import assert from "node:assert/strict";
import { ParseFailed } from "../src/grammar/engine.js";
import { grammarImplementation } from "../src/flavors/index.js";
import {
  CenPfsAdoptedEuropeanNorm,
  CenPfsIdentifier,
  CenPfsEuropeanNorm,
} from "../src/flavors/cen_pfs/index.js";
import { resolveType } from "../src/model/identifier.js";
import type { BaseIdentifier } from "../src/model/identifier.js";
import { flavorSchema } from "../src/pubid-urn/index.js";

// The cen_pfs parity gate (pubid/pubid#706; the cen_pfs full absorption
// is pubid-grammar#121 + pubid#721's regeneration): the PFS-compiled
// TS cen_pfs flavor and the coded TS cen_cenelec flavor must agree
// BYTE-FOR-BYTE over the shared conformance set — the FULL 189-row
// corpus inventory the Ruby harness (spec/pubid/cen_pfs/parity_spec.rb)
// consumes, its constructed former-gaps faces and its declared
// negatives, together with the reference outputs both Ruby flavors
// produce for it (the fixture is the gzip of
// scripts/cen-pfs-parity-ruby-probe.rb's export). One conformance set,
// both engines. Drift is a defect in the definition, the compiler
// artifact or this port — never a reason to relax an expectation here.

interface RubyOutputs {
  to_s: string;
  to_hash: Record<string, unknown>;
  /** Recorded for the shared set's completeness; no TS counterpart yet. */
  to_mr_string: string;
  to_urn: string;
  to_pubid_urn: string;
}

interface Row {
  input: string;
  file?: string;
  ruby: Record<"cen_cenelec" | "cen_pfs", RubyOutputs>;
  agree: boolean;
}

interface NegativeRow {
  input: string;
  ruby: Record<"cen_cenelec" | "cen_pfs", string>;
}

interface ParityFixture {
  provenance: {
    generator: string;
    source_spec: string;
    inventory: string;
    pubid_ref: string;
    pubid_version: string;
    pubid_dirty_tree: boolean;
    testsuite_ref: string;
    notes: string;
  };
  inventory: Row[];
  faces: Row[];
  negatives: NegativeRow[];
}

const fixture: ParityFixture = JSON.parse(
  gunzipSync(
    readFileSync(new URL("../../test/fixtures/cen-pfs-parity.json.gz", import.meta.url)),
  ).toString("utf8"),
);

// The gate is the FULL inventory (the harness ledger pins the size).
const INVENTORY_SIZE = 189;
assert.equal(fixture.inventory.length, INVENTORY_SIZE, "the committed inventory must be the full gate");
assert.equal(fixture.provenance.pubid_dirty_tree, false, "the fixture must come from a clean pubid tree");
assert.ok(fixture.provenance.pubid_ref, "the fixture must name the pubid ref it was generated at");

const coded = grammarImplementation("cen_cenelec")!;
const pfs = grammarImplementation("cen_pfs")!;

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

test("the fixture itself is sound: both Ruby flavors recorded agreeing outputs", () => {
  for (const row of [...fixture.inventory, ...fixture.faces]) {
    assert.ok(row.agree, `ruby-cen_cenelec == ruby-cen_pfs must hold on ${row.input}`);
  }
  const ledger = new Map<string, number>();
  for (const row of fixture.inventory) {
    assert.ok(row.file !== undefined, "every inventory row names its payload file");
    ledger.set(row.file!, (ledger.get(row.file!) ?? 0) + 1);
  }
  // The harness's pinned per-file ledger (the corpus conservation): a
  // corpus addition or regression turns the fixture regeneration red.
  assert.deepEqual(
    Object.fromEntries([...ledger].sort(([a], [b]) => a.localeCompare(b))),
    {
      adopted_european_norm: 17,
      amendment: 15,
      cen_report: 22,
      cen_workshop_agreement: 1,
      consolidated_identifier: 18,
      corrigendum: 14,
      european_norm: 67,
      european_prestandard: 7,
      european_specification: 2,
      fragment: 1,
      guide: 11,
      harmonization_document: 3,
      technical_report: 7,
      technical_specification: 4,
    },
  );
});

test(`both TS flavors agree byte-for-byte, and with the Ruby reference, over all ${INVENTORY_SIZE} inventory rows`, () => {
  let ok = 0;
  const misses: string[] = [];
  for (const row of fixture.inventory) {
    try {
      const codedId = coded.parse(row.input) as BaseIdentifier;
      const pfsId = pfs.parse(row.input) as BaseIdentifier;
      let rowOk = true;
      const miss = (detail: string): void => {
        rowOk = false;
        if (misses.length < 8) misses.push(`${row.input}: ${detail}`);
      };
      // Class-level semantics: the compiled hierarchy answers (the
      // declared document families, the synthesized wrappers), and the
      // scheme's canonical wire tag is shared with the coded flavor.
      if (!(pfsId instanceof CenPfsIdentifier)) miss("the compiled flavor must answer its compiled hierarchy");
      assert.equal(
        (pfsId.constructor as unknown as { polymorphicName: string }).polymorphicName,
        (codedId.constructor as unknown as { polymorphicName: string }).polymorphicName,
      );
      for (const method of METHODS) {
        const codedOut = read(codedId, method);
        const pfsOut = read(pfsId, method);
        // TS-vs-TS: byte-for-byte, on every row.
        if (!deepEq(pfsOut, codedOut)) miss(`cen_pfs ${method} must equal the coded flavor's`);
        // Cross-engine: the TS output equals both Ruby columns (the
        // harness already asserts the two Ruby flavors agree).
        if (!deepEq(pfsOut, row.ruby.cen_pfs[method])) miss(`TS ${method} must equal the Ruby compiled reference's`);
        if (!deepEq(codedOut, row.ruby.cen_cenelec[method])) miss(`TS coded ${method} must equal the Ruby coded reference's`);
      }
      // The alias's own round trip rides the same pass.
      const rebuilt = CenPfsIdentifier.fromHash(pfsId.toHash());
      if (!(rebuilt instanceof CenPfsIdentifier)) miss("fromHash must route the scheme tag back to the compiled class");
      else if (!deepEq(rebuilt.toHash(), pfsId.toHash())) miss("the from_hash round trip must preserve the hash");
      if (rowOk) ok += 1;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (misses.length < 8) misses.push(`${row.input}: threw ${message.slice(0, 80)}`);
    }
  }
  assert.equal(misses.length, 0, `${ok}/${fixture.inventory.length} rows byte-parity; first misses:
${misses.join("\n")}`);
  assert.equal(ok, INVENTORY_SIZE);
});

for (const face of fixture.faces) {
  test(`the constructed face ${face.input} matches the coded flavor, and the Ruby reference`, () => {
    assert.ok(face.agree);
    const codedId = coded.parse(face.input) as BaseIdentifier;
    const pfsId = pfs.parse(face.input) as BaseIdentifier;
    assert.equal(pfsId.toString(), codedId.toString());
    assert.equal(pfsId.toString(), face.ruby.cen_pfs.to_s);
    assert.deepEqual(pfsId.toHash(), codedId.toHash());
    assert.deepEqual(pfsId.toHash(), face.ruby.cen_pfs.to_hash);
    assert.equal(pfsId.toUrn(), face.ruby.cen_pfs.to_urn);
    assert.equal(pfsId.toPubidUrn(), face.ruby.cen_pfs.to_pubid_urn);
    const rebuilt = CenPfsIdentifier.fromHash(pfsId.toHash());
    assert.deepEqual(rebuilt.toHash(), pfsId.toHash());
  });
}

for (const row of fixture.negatives) {
  test(`both TS flavors reject ${row.input} like the Ruby flavors`, () => {
    assert.equal(row.ruby.cen_cenelec, "rejected");
    assert.equal(row.ruby.cen_pfs, "rejected");
    assert.throws(() => coded.parse(row.input), ParseFailed);
    assert.throws(() => pfs.parse(row.input), ParseFailed);
  });
}

test("the compiled classes stay out of the global type map", () => {
  // One scheme, one _type, one global resolution: every scheme tag the
  // coded flavor registers still resolves the CODED class everywhere
  // global ("pubid:cencenelec:identifier" is the coded schema's
  // declared-but-unresolved generic — it joins doi_pfs's two and etsi's
  // one in the missing set).
  for (const tag of [
    "pubid:cencenelec:european-norm",
    "pubid:cencenelec:adopted-european-norm",
    "pubid:cencenelec:amendment",
    "pubid:cencenelec:corrigendum",
    "pubid:cencenelec:consolidated-identifier",
    "pubid:cencenelec:fragment",
  ]) {
    const global = resolveType(tag);
    assert.ok(global, `${tag} must resolve globally (the coded class)`);
    assert.notEqual(global, CenPfsEuropeanNorm, `${tag} must not resolve a compiled class`);
    assert.equal(
      (global!.prototype as unknown) instanceof CenPfsIdentifier,
      false,
      `${tag} must not resolve into the compiled hierarchy`,
    );
  }
  assert.equal(resolveType("pubid:cencenelec:identifier"), undefined, "the generic tag stays unresolved, as under the coded schema");
  assert.ok(coded.parse("EN 1325") instanceof resolveType("pubid:cencenelec:european-norm")!);
  // ...while the alias's own fromHash routes the same tags locally (the
  // flavor map first, exactly the Ruby flavor-base order), and the
  // cross-flavor nested identifier still resolves globally.
  const rebuilt = CenPfsIdentifier.fromHash({
    _type: "pubid:cencenelec:european-norm",
    number: "1325",
  });
  assert.ok(rebuilt instanceof CenPfsEuropeanNorm);
  const chain = CenPfsIdentifier.fromHash({
    _type: "pubid:cencenelec:corrigendum",
    year: "2016",
    base: {
      _type: "pubid:cencenelec:adopted-european-norm",
      adopted: { _type: "pubid:iso:international-standard", number: "13485", year: "2016" },
    },
  });
  assert.ok(chain instanceof CenPfsIdentifier, "the wrapper tags route back to the compiled wrappers");
  const adopted = (chain as unknown as Record<string, unknown>)["base"] as CenPfsIdentifier;
  assert.ok(adopted instanceof CenPfsAdoptedEuropeanNorm, "the compiled adopted wrapper rebuilds");
  assert.equal(
    ((adopted as unknown as Record<string, unknown>)["adopted"] as BaseIdentifier).toHash()["_type"],
    "pubid:iso:international-standard",
    "the nested adopted document resolves through the global registry (TypeResolver order)",
  );
});

test("the compiled flavor joins the pubid-urn schema registry under its own key", () => {
  // Registered under the FLAVOR key ("cen_pfs") — never under
  // "cencenelec": the identifiers carry the scheme's canonical wire tag,
  // so their pubid URNs encode through the coded flavor's schema.
  assert.ok(flavorSchema("cen_pfs"), "cen_pfs schema must be registered");
  assert.ok(flavorSchema("cencenelec"), "the coded schema must be untouched");
});

function deepEq(a: unknown, b: unknown): boolean {
  try {
    assert.deepEqual(a, b);
    return true;
  } catch {
    return false;
  }
}
