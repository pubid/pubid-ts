import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { test } from "node:test";
import assert from "node:assert/strict";
import { ParseFailed } from "../src/grammar/engine.js";
import { grammarImplementation } from "../src/flavors/index.js";
import {
  BsiPfsAdoptedEuropeanNorm,
  BsiPfsIdentifier,
  BsiPfsBritishStandard,
} from "../src/flavors/bsi_pfs/index.js";
import { resolveType } from "../src/model/identifier.js";
import type { BaseIdentifier } from "../src/model/identifier.js";
import { flavorSchema } from "../src/pubid-urn/index.js";

// The bsi_pfs parity gate (pubid/pubid#706 §4, the module-composition
// proof flavor; pubid-ts#227): the PFS-compiled TS bsi_pfs flavor and
// the coded TS bsi flavor must agree BYTE-FOR-BYTE over the absorbed
// 843-row corpus inventory the Ruby harness
// (spec/pubid/bsi_pfs/parity_spec.rb) measures, its constructed
// composition faces and its declared negatives, together with the
// reference outputs both Ruby flavors produce for it (the fixture is
// the gzip of scripts/bsi-pfs-parity-ruby-probe.rb's export). One
// conformance set, both engines.
//
// THE LEDGER IS THE CONTRACT: the fixture also carries the harness's
// 657-row unabsorbed boundary — every row the bsi_pfs composition does
// NOT absorb must stay a parse rejection in the TS engine, never a
// wrong class. No loosening: a compiled acceptance over a ledger row
// fails this gate exactly as it fails the Ruby spec.

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
  id?: string;
  ruby: Record<"bsi" | "bsi_pfs", RubyOutputs>;
  agree: boolean;
}

interface RejectionRow {
  input: string;
  ruby: Record<"bsi" | "bsi_pfs", string>;
}

interface LedgerRow {
  id: string;
  input: string;
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
  negatives: RejectionRow[];
  boundary: RejectionRow[];
  ledger: LedgerRow[];
}

const fixture: ParityFixture = JSON.parse(
  gunzipSync(
    readFileSync(new URL("../../test/fixtures/bsi-pfs-parity.json.gz", import.meta.url)),
  ).toString("utf8"),
);

// The gate is the FULL inventory (the harness ledger pins the split:
// 843 absorbed / 657 unabsorbed over the 1,500 corpus rows).
const ABSORBED_SIZE = 843;
const LEDGER_SIZE = 657;
assert.equal(fixture.inventory.length, ABSORBED_SIZE, "the committed inventory must be the full absorbed gate");
assert.equal(fixture.ledger.length, LEDGER_SIZE, "the committed ledger must be the full unabsorbed boundary");
assert.equal(fixture.provenance.pubid_dirty_tree, false, "the fixture must come from a clean pubid tree");
assert.ok(fixture.provenance.pubid_ref, "the fixture must name the pubid ref it was generated at");

const coded = grammarImplementation("bsi")!;
const pfs = grammarImplementation("bsi_pfs")!;

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

// The harness's pinned per-file ledger (the corpus conservation): the
// absorbed/unabsorbed split per payload file — a corpus addition or a
// regression turns the fixture regeneration red, and a TS port that
// loosens the boundary turns THIS gate red.
const LEDGER: Record<string, { absorbed: number; unabsorbed: number }> = {
  addendum_document: { absorbed: 0, unabsorbed: 22 },
  adopted_european_norm: { absorbed: 267, unabsorbed: 0 },
  adopted_international_standard: { absorbed: 74, unabsorbed: 7 },
  aerospace_standard: { absorbed: 0, unabsorbed: 339 },
  british_standard: { absorbed: 304, unabsorbed: 42 },
  bundled_identifier: { absorbed: 0, unabsorbed: 27 },
  committee_document: { absorbed: 0, unabsorbed: 6 },
  consolidated_identifier: { absorbed: 52, unabsorbed: 46 },
  detailed_specification: { absorbed: 0, unabsorbed: 16 },
  disc: { absorbed: 0, unabsorbed: 9 },
  draft_document: { absorbed: 13, unabsorbed: 0 },
  expert_commentary: { absorbed: 0, unabsorbed: 25 },
  explanatory_supplement: { absorbed: 0, unabsorbed: 1 },
  flex: { absorbed: 0, unabsorbed: 23 },
  index: { absorbed: 0, unabsorbed: 13 },
  method: { absorbed: 0, unabsorbed: 14 },
  national_annex: { absorbed: 0, unabsorbed: 18 },
  publicly_available_specification: { absorbed: 56, unabsorbed: 0 },
  published_document: { absorbed: 74, unabsorbed: 2 },
  section: { absorbed: 0, unabsorbed: 11 },
  set: { absorbed: 0, unabsorbed: 1 },
  standalone_amendment: { absorbed: 0, unabsorbed: 4 },
  supplement_document: { absorbed: 0, unabsorbed: 18 },
  supplementary_index: { absorbed: 0, unabsorbed: 1 },
  technical_specification: { absorbed: 3, unabsorbed: 0 },
  test_method: { absorbed: 0, unabsorbed: 6 },
  value_added_publication: { absorbed: 0, unabsorbed: 6 },
};

test("the fixture itself is sound: ruby absorbed/unabsorbed split matches the pinned ledger", () => {
  for (const row of [...fixture.inventory, ...fixture.faces]) {
    assert.ok(row.agree, `ruby-bsi == ruby-bsi_pfs must hold on ${row.input}`);
  }
  const absorbed = new Map<string, number>();
  for (const row of fixture.inventory) {
    assert.ok(row.file !== undefined, "every absorbed row names its payload file");
    absorbed.set(row.file!, (absorbed.get(row.file!) ?? 0) + 1);
  }
  const unabsorbedFiles = new Set(fixture.inventory.map((r) => r.file!));
  for (const [fname, counts] of Object.entries(LEDGER)) {
    assert.equal(absorbed.get(fname) ?? 0, counts.absorbed, `the absorbed count for ${fname} moved`);
    if (counts.unabsorbed > 0) unabsorbedFiles.add(fname);
  }
  // The ledger rows must exist and reject-count up to the pinned 657
  // (the probe already keyed them against the Ruby spec's own ledger).
  assert.equal(fixture.ledger.length, LEDGER_SIZE);
  assert.equal(unabsorbedFiles.size, Object.keys(LEDGER).length, "the ledger must cover every payload file");
});

test(`both TS flavors agree byte-for-byte, and with the Ruby reference, over all ${ABSORBED_SIZE} absorbed rows`, () => {
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
      if (!(pfsId instanceof BsiPfsIdentifier)) miss("the compiled flavor must answer its compiled hierarchy");
      assert.equal(
        (pfsId.constructor as unknown as { polymorphicName: string }).polymorphicName,
        (codedId.constructor as unknown as { polymorphicName: string }).polymorphicName,
      );
      for (const method of METHODS) {
        const codedOut = read(codedId, method);
        const pfsOut = read(pfsId, method);
        // TS-vs-TS: byte-for-byte, on every row.
        if (!deepEq(pfsOut, codedOut)) miss(`bsi_pfs ${method} must equal the coded flavor's`);
        // Cross-engine: the TS output equals both Ruby columns (the
        // harness already asserts the two Ruby flavors agree).
        if (!deepEq(pfsOut, row.ruby.bsi_pfs[method])) miss(`TS ${method} must equal the Ruby compiled reference's`);
        if (!deepEq(codedOut, row.ruby.bsi[method])) miss(`TS coded ${method} must equal the Ruby coded reference's`);
      }
      // The alias's own round trip rides the same pass.
      const rebuilt = BsiPfsIdentifier.fromHash(pfsId.toHash());
      if (!(rebuilt instanceof BsiPfsIdentifier)) miss("fromHash must route the scheme tag back to the compiled class");
      else if (!deepEq(rebuilt.toHash(), pfsId.toHash())) miss("the from_hash round trip must preserve the hash");
      if (rowOk) ok += 1;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (misses.length < 8) misses.push(`${row.input}: threw ${message.slice(0, 80)}`);
    }
  }
  assert.equal(misses.length, 0, `${ok}/${fixture.inventory.length} rows byte-parity; first misses:
${misses.join("\n")}`);
  assert.equal(ok, ABSORBED_SIZE);
});

test(`all ${LEDGER_SIZE} unabsorbed ledger rows stay fail-closed: the compiled flavor rejects, never a wrong class`, () => {
  let rejected = 0;
  const misses: string[] = [];
  for (const row of fixture.ledger) {
    try {
      const pfsId = pfs.parse(row.input) as BaseIdentifier;
      rejected += 0;
      if (misses.length < 8) {
        misses.push(
          `${row.id} (${row.input}): the compiled flavor ACCEPTED a row the boundary refuses ` +
            `(${(pfsId.constructor as unknown as { polymorphicName: string }).polymorphicName})`,
        );
      }
    } catch (e) {
      if (e instanceof ParseFailed) rejected += 1;
      else if (misses.length < 8) {
        misses.push(`${row.id} (${row.input}): rejected with a non-parse error ${String(e).slice(0, 60)}`);
      }
    }
  }
  assert.equal(misses.length, 0, `fail-closed receipt ${rejected}/${fixture.ledger.length}; first misses:
${misses.join("\n")}`);
  assert.equal(rejected, LEDGER_SIZE);
});

for (const face of fixture.faces) {
  test(`the constructed composition face ${face.input} matches the coded flavor, and the Ruby reference`, () => {
    assert.ok(face.agree);
    const codedId = coded.parse(face.input) as BaseIdentifier;
    const pfsId = pfs.parse(face.input) as BaseIdentifier;
    assert.equal(pfsId.toString(), codedId.toString());
    assert.equal(pfsId.toString(), face.ruby.bsi_pfs.to_s);
    assert.deepEqual(pfsId.toHash(), codedId.toHash());
    assert.deepEqual(pfsId.toHash(), face.ruby.bsi_pfs.to_hash);
    assert.equal(pfsId.toUrn(), face.ruby.bsi_pfs.to_urn);
    assert.equal(pfsId.toPubidUrn(), face.ruby.bsi_pfs.to_pubid_urn);
    const rebuilt = BsiPfsIdentifier.fromHash(pfsId.toHash());
    assert.deepEqual(rebuilt.toHash(), pfsId.toHash());
  });
}

for (const row of fixture.negatives) {
  test(`both TS flavors reject ${row.input} like the Ruby flavors`, () => {
    assert.equal(row.ruby.bsi, "rejected");
    assert.equal(row.ruby.bsi_pfs, "rejected");
    // The coded flavor's rejection face is its own (the coded bsi shell
    // throws bare Error); the compiled flavor's is the parse-failure
    // contract: a ParseFailed, never a wrong-class error.
    assert.throws(() => coded.parse(row.input));
    assert.throws(() => pfs.parse(row.input), ParseFailed);
  });
}

for (const row of fixture.boundary) {
  test(`the boundary holds in TS: ${row.input} parses coded, refuses composed`, () => {
    assert.equal(row.ruby.bsi, "accepted");
    assert.equal(row.ruby.bsi_pfs, "rejected");
    // The coded flavor accepts the row (it belongs to another family of
    // the coded model); the composition must not accept what its model
    // cannot represent — accepting without representing is the silent
    // failure the fail-closed contract exists to prevent.
    assert.doesNotThrow(() => coded.parse(row.input));
    assert.throws(() => pfs.parse(row.input), ParseFailed);
  });
}

test("the compiled classes stay out of the global type map", () => {
  // One scheme, one _type, one global resolution: every scheme tag the
  // coded flavor registers still resolves the CODED class everywhere
  // global; the compiled aliases answer only through their own fromHash.
  for (const tag of [
    "pubid:bsi:british-standard",
    "pubid:bsi:adopted-european-norm",
    "pubid:bsi:adopted-international-standard",
    "pubid:bsi:amendment",
    "pubid:bsi:corrigendum",
    "pubid:bsi:consolidated-identifier",
    "pubid:bsi:draft-document",
    "pubid:bsi:published-document",
    "pubid:bsi:publicly-available-specification",
    "pubid:bsi:technical-specification",
  ]) {
    const global = resolveType(tag);
    assert.ok(global, `${tag} must resolve globally (the coded class)`);
    assert.notEqual(global, BsiPfsBritishStandard, `${tag} must not resolve a compiled class`);
    assert.equal(
      (global!.prototype as unknown) instanceof BsiPfsIdentifier,
      false,
      `${tag} must not resolve into the compiled hierarchy`,
    );
  }
  assert.ok(coded.parse("BS 10005:1995") instanceof resolveType("pubid:bsi:british-standard")!);
  // ...while the alias's own fromHash routes the same tags locally (the
  // flavor map first, exactly the Ruby flavor-base order), and the
  // cross-flavor nested identifier still resolves globally.
  const rebuilt = BsiPfsIdentifier.fromHash({
    _type: "pubid:bsi:british-standard",
    number: "10005",
    year: "1995",
  });
  assert.ok(rebuilt instanceof BsiPfsBritishStandard);
  const chain = BsiPfsIdentifier.fromHash({
    _type: "pubid:bsi:adopted-european-norm",
    publisher: { body: "BS" },
    base: {
      _type: "pubid:cencenelec:european-norm",
      number: "1073",
      part: "2",
      year: "2002",
    },
  });
  assert.ok(chain instanceof BsiPfsAdoptedEuropeanNorm, "the compiled adopted wrapper rebuilds");
  const adopted = (chain as unknown as Record<string, unknown>)["base"] as BaseIdentifier;
  assert.equal(
    adopted.toHash()["_type"],
    "pubid:cencenelec:european-norm",
    "the nested adopted document resolves through the global registry (TypeResolver order)",
  );
});

test("the compiled flavor joins the pubid-urn schema registry under its own key", () => {
  // Registered under the FLAVOR key ("bsi_pfs") — never under "bsi":
  // the identifiers carry the scheme's canonical wire tag, so their
  // pubid URNs encode through the coded flavor's schema.
  assert.ok(flavorSchema("bsi_pfs"), "bsi_pfs schema must be registered");
  assert.ok(flavorSchema("bsi"), "the coded schema must be untouched");
});

function deepEq(a: unknown, b: unknown): boolean {
  try {
    assert.deepEqual(a, b);
    return true;
  } catch {
    return false;
  }
}
