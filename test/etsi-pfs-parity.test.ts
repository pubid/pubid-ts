import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { test } from "node:test";
import assert from "node:assert/strict";
import { ParseFailed } from "../src/grammar/engine.js";
import { grammarImplementation } from "../src/flavors/index.js";
import { EtsiPfsIdentifier, EtsiPfsStandardIdentifier } from "../src/flavors/etsi_pfs/index.js";
import { resolveType } from "../src/model/identifier.js";
import type { BaseIdentifier } from "../src/model/identifier.js";
import { flavorSchema } from "../src/pubid-urn/index.js";

// The etsi_pfs parity gate (pubid/pubid#706 phase 3): the PFS-compiled
// TS flavor and the coded TS etsi flavor must agree BYTE-FOR-BYTE over
// the shared conformance set — the FULL 24,718-row inventory the Ruby
// harness (spec/pubid/etsi_pfs/parity_spec.rb) consumes, its constructed
// PARITY_INPUTS and its PARITY_NEGATIVES, together with the reference
// outputs both Ruby flavors produce for it (the fixture is the gzip of
// scripts/etsi-pfs-parity-ruby-probe.rb's export). One conformance set,
// both engines. Drift is a defect in the definition, the compiler
// artifact or this port — never a reason to relax an expectation here.

interface RubyOutputs {
  to_s: string;
  to_hash: Record<string, unknown>;
  /** null = the coded flavor's month-08/09 to_urn raise (see to_urn_quirk). */
  to_urn: string | null;
  to_urn_quirk?: string;
  to_mr_string: string;
  to_pubid_urn: string;
}

interface Row {
  input: string;
  ruby: Record<"etsi" | "etsi_pfs", RubyOutputs>;
  agree: boolean;
}

interface NegativeRow {
  input: string;
  ruby: Record<"etsi" | "etsi_pfs", string>;
}

interface ParityFixture {
  provenance: {
    generator: string;
    source_spec: string;
    inventory: string;
    pubid_ref: string;
    pubid_dirty_tree: boolean;
    notes: string;
  };
  inventory: Row[];
  faces: Row[];
  negatives: NegativeRow[];
}

const fixture: ParityFixture = JSON.parse(
  gunzipSync(
    readFileSync(new URL("../../test/fixtures/etsi-pfs-parity.json.gz", import.meta.url)),
  ).toString("utf8"),
);

// The gate is the FULL inventory (the harness pins the size itself).
const INVENTORY_SIZE = 24_718;
assert.equal(fixture.inventory.length, INVENTORY_SIZE, "the committed inventory must be the full gate");

const coded = grammarImplementation("etsi")!;
const pfs = grammarImplementation("etsi_pfs")!;

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

const quirks = fixture.inventory.filter((row) => row.ruby.etsi.to_urn_quirk !== undefined);

test("the fixture itself is sound: both Ruby flavors recorded agreeing outputs", () => {
  for (const row of [...fixture.inventory, ...fixture.faces]) {
    assert.ok(row.agree, `ruby-etsi == ruby-etsi_pfs must hold on ${row.input}`);
    assert.ok(!row.ruby.etsi_pfs.to_urn_quirk, "the compiled Ruby generator never carries the coded quirk");
  }
  assert.ok(quirks.length > 0, "the inventory must exercise the coded month-08/09 to_urn defect the harness documents");
});

test("TS comparison basis on the coded to_urn quirk rows is the compiled output", () => {
  // The coded flavor's pre-existing defect: format('%02d', month) on the
  // zero-padded "08"/"09" string raises. The TS coded flavor does NOT
  // share it (the port renders the captured month verbatim through
  // padStart), so the TS-vs-TS to_urn comparison holds on EVERY row; the
  // quirk rows compare the TS outputs against the COMPILED Ruby output
  // (already enforced in the loop below — the nil coded column is
  // skipped there).
  const row = quirks[0]!;
  assert.ok(row.ruby.etsi.to_urn === null, "the quirk rows record a nil coded to_urn");
  assert.match(row.ruby.etsi.to_urn_quirk!, /^ArgumentError/);
  assert.equal(
    coded.parse(row.input).toUrn(),
    pfs.parse(row.input).toUrn(),
    "the TS coded flavor renders the quirk row's to_urn like the compiled one, no raise",
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
      // Class-level semantics: distinct classes, same declared shape —
      // the compiled hierarchy answers (the standard for bare rows, the
      // synthesized wrappers for supplement rows).
      if (!(pfsId instanceof EtsiPfsIdentifier)) miss("the compiled flavor must answer its compiled hierarchy");
      for (const method of METHODS) {
        const codedOut = read(codedId, method);
        const pfsOut = read(pfsId, method);
        // TS-vs-TS: byte-for-byte, on every row (the coded TS flavor
        // shares none of the coded Ruby generator's month quirk).
        if (!deepEq(pfsOut, codedOut)) miss(`etsi_pfs ${method} must equal the coded flavor's`);
        // Cross-engine: the TS output equals the Ruby reference's — the
        // compiled column on every surface, the coded column wherever it
        // recorded a value (the quirk rows' nil to_urn compares on the
        // compiled basis, asserted above).
        if (!deepEq(pfsOut, row.ruby.etsi_pfs[method])) miss(`TS ${method} must equal the Ruby compiled reference's`);
        const codedRuby = row.ruby.etsi[method];
        if (method !== "to_urn" || codedRuby !== null) {
          if (!deepEq(codedOut, codedRuby)) miss(`TS coded ${method} must equal the Ruby coded reference's`);
        }
      }
      // The alias's own round trip rides the same pass.
      const rebuilt = EtsiPfsIdentifier.fromHash(pfsId.toHash());
      if (!(rebuilt instanceof EtsiPfsIdentifier)) miss("fromHash must route the scheme tag back to the compiled class");
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
    assert.equal(pfsId.toString(), face.ruby.etsi_pfs.to_s);
    assert.deepEqual(pfsId.toHash(), codedId.toHash());
    assert.deepEqual(pfsId.toHash(), face.ruby.etsi_pfs.to_hash);
    assert.equal(pfsId.toUrn(), face.ruby.etsi_pfs.to_urn);
    assert.equal(pfsId.toPubidUrn(), face.ruby.etsi_pfs.to_pubid_urn);
    const rebuilt = EtsiPfsIdentifier.fromHash(pfsId.toHash());
    assert.deepEqual(rebuilt.toHash(), pfsId.toHash());
  });
}

for (const row of fixture.negatives) {
  test(`both TS flavors reject ${row.input} like the Ruby flavors`, () => {
    assert.equal(row.ruby.etsi, "rejected");
    assert.equal(row.ruby.etsi_pfs, "rejected");
    assert.throws(() => coded.parse(row.input), ParseFailed);
    assert.throws(() => pfs.parse(row.input), ParseFailed);
  });
}

test("the compiled classes stay out of the global type map", () => {
  // One scheme, one _type, one global resolution: every scheme tag the
  // coded flavor registers still resolves the CODED class everywhere
  // global ("pubid:etsi:identifier" is the coded schema's declared-but-
  // unresolved type — it joins doi_pfs's two in the missing set).
  for (const tag of ["pubid:etsi:etsi-standard", "pubid:etsi:amendment", "pubid:etsi:corrigendum"]) {
    const global = resolveType(tag);
    assert.ok(global, `${tag} must resolve globally (the coded class)`);
    assert.notEqual(global, EtsiPfsStandardIdentifier, `${tag} must not resolve a compiled class`);
    assert.equal(
      global!.prototype instanceof EtsiPfsIdentifier,
      false,
      `${tag} must not resolve into the compiled hierarchy`,
    );
  }
  assert.equal(resolveType("pubid:etsi:identifier"), undefined, "the generic tag stays unresolved, as under the coded schema");
  assert.ok(coded.parse("ETSI EG 200 053") instanceof resolveType("pubid:etsi:etsi-standard")!);
  // ...while the alias's own fromHash routes the same tags locally.
  const rebuilt = EtsiPfsIdentifier.fromHash({ _type: "pubid:etsi:etsi-standard", type: "EG", number: "200 053" });
  assert.ok(rebuilt instanceof EtsiPfsStandardIdentifier);
  const chain = EtsiPfsIdentifier.fromHash({
    _type: "pubid:etsi:corrigendum",
    number: 1,
    base: { _type: "pubid:etsi:amendment", number: 1, base: { _type: "pubid:etsi:etsi-standard", type: "EG", number: "200 053" } },
  });
  assert.ok(chain instanceof EtsiPfsIdentifier, "the wrapper tags route back to the compiled wrappers");
});

test("the compiled flavor joins the pubid-urn schema registry under its own key", () => {
  // Registered under the FLAVOR key ("etsi_pfs") — never under "etsi":
  // the identifiers carry the scheme's canonical wire tag, so their pubid
  // URNs encode through the coded flavor's schema.
  assert.ok(flavorSchema("etsi_pfs"), "etsi_pfs schema must be registered");
  assert.ok(flavorSchema("etsi"), "the coded schema must be untouched");
});

function deepEq(a: unknown, b: unknown): boolean {
  try {
    assert.deepEqual(a, b);
    return true;
  } catch {
    return false;
  }
}
