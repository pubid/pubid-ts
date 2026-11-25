import { test } from "node:test";
import assert from "node:assert/strict";
import { grammarImplementation } from "../src/flavors/index.js";

// The IHO S-158 series model (pubid#774) and the URN defect fixes
// (pubid#775), reconciled against the merged gem reference (pubid#776),
// plus the whole-flavor MRN migration to the adopted IHO MRN guidance
// scheme (spec/per/reg for S/P/M; B/C keep the legacy emission).
//
// product is the typed facet for the S-100 product number whose
// validation checks the publication specifies. "S-158:<NNN>" is the
// PRIMARY designator form (number=158, product=NNN — never an
// opaque number, never a part); the draft-era spellings "S-158 Part
// S-102" / "S-158-S-102" / "S-158 Part 102" bind the SAME identity as
// non-normalized aliases: render keeps the input spelling (the face
// carries the part value as written), equality and both URNs use the
// canonical shape, and the citation face order never moves identity or
// URN segments (the pubid#775 mis-bind — the trailing edition gluing
// into part_edition, parted-0.2.0 — dies with the part capture).

const impl = grammarImplementation("iho")!;

type Parsed = ReturnType<typeof impl.parse>;

/** The Identifier port interface carries optional URN/equals methods;
 *  the iho implementation always provides them. */
function urnOf(id: Parsed): string {
  const urn = id.toUrn();
  assert.ok(urn !== undefined, "the iho flavor emits a URN");
  return urn;
}

function pubidUrnOf(id: Parsed): string {
  assert.ok(id.toPubidUrn !== undefined, "the iho implementation carries toPubidUrn");
  return id.toPubidUrn();
}

test("S-158 colon designator is the primary form", () => {
  const id = impl.parse("IHO S-158:102 1.0.0");
  assert.deepEqual(id.toHash(), {
    _type: "pubid:iho:standard",
    number: "158",
    product: "102",
    edition: "1.0.0",
  });
  // The human face keeps the colon spelling.
  assert.equal(id.toHuman(), "IHO S-158:102 1.0.0");
  // MRN: the product member hyphenates into the name segment, the
  // edition keeps its canonical position (the guidance's <edition
  // number> slot).
  assert.equal(urnOf(id), "urn:mrn:iho:pub:spec:s158-102:1.0.0");
  // pubid-URN: the typed product- atom rides the document code, before
  // the edition.
  assert.equal(pubidUrnOf(id), "urn:pubid:iho:std:158:product-102:ed-1.0.0");
});

test("the product member covers every S-100 product number", () => {
  for (const [input, member] of [
    ["IHO S-158:100", "100"],
    ["IHO S-158:98", "98"],
    ["IHO S-158:128", "128"],
  ] as const) {
    const id = impl.parse(input);
    assert.equal(id.toHash()["product"], member);
    assert.equal(id.toHash()["number"], "158");
    assert.equal(id.toHash()["edition"], undefined);
    assert.equal(urnOf(id), `urn:mrn:iho:pub:spec:s158-${member}`);
    assert.equal(pubidUrnOf(id), `urn:pubid:iho:std:158:product-${member}`);
  }
});

test("the S-158 framework publication has no product member", () => {
  const id = impl.parse("IHO S-158 1.0.0");
  assert.deepEqual(id.toHash(), {
    _type: "pubid:iho:standard",
    number: "158",
    edition: "1.0.0",
  });
  assert.equal(urnOf(id), "urn:mrn:iho:pub:spec:s158:1.0.0");
  assert.equal(pubidUrnOf(id), "urn:pubid:iho:std:158:ed-1.0.0");
});

test("draft-era spellings bind the same identity", () => {
  // The expanded part face, the compact face and the bare-number part
  // face all parse to product=102 — never a part, never a
  // parted- edition.
  const spellings = [
    "IHO S-158:102 0.2.0",
    "IHO S-158 0.2.0 Part S-102",
    "IHO S-158 Part S-102 0.2.0",
    "IHO S-158-S-102 0.2.0",
    "IHO S-158 Part 102 0.2.0",
  ];
  const ids = spellings.map((s) => impl.parse(s));
  assert.deepEqual(ids[0]!.toHash(), {
    _type: "pubid:iho:standard",
    number: "158",
    product: "102",
    edition: "0.2.0",
  });
  for (const [index, id] of ids.entries()) {
    assert.deepEqual(
      id.toHash(),
      ids[0]!.toHash(),
      `${spellings[index]} hash`,
    );
    assert.equal(id.toHash()["part"], undefined);
    assert.equal(id.toHash()["part_edition"], undefined);
  }
  // ...one identity: every spelling equals every other.
  for (const a of ids) {
    for (const b of ids) assert.ok(a.equals!(b));
  }
});

test("render keeps the input spelling; URNs stay canonical", () => {
  assert.equal(impl.parse("IHO S-158:102 0.2.0").toHuman(), "IHO S-158:102 0.2.0");
  assert.equal(impl.parse("IHO S-158 0.2.0 Part S-102").toHuman(), "IHO S-158 0.2.0 Part S-102");
  // The compact face renders expanded (the S-5A law); the bare-number
  // face keeps its own spelling.
  assert.equal(impl.parse("IHO S-158-S-102 0.2.0").toHuman(), "IHO S-158 0.2.0 Part S-102");
  assert.equal(impl.parse("IHO S-158 Part 102 0.2.0").toHuman(), "IHO S-158 0.2.0 Part 102");
  const canonicalMrn = "urn:mrn:iho:pub:spec:s158-102:0.2.0";
  const canonicalPubidUrn = "urn:pubid:iho:std:158:product-102:ed-0.2.0";
  for (const spelling of [
    "IHO S-158:102 0.2.0",
    "IHO S-158 0.2.0 Part S-102",
    "IHO S-158 Part S-102 0.2.0",
    "IHO S-158-S-102 0.2.0",
    "IHO S-158 Part 102 0.2.0",
  ]) {
    const id = impl.parse(spelling);
    assert.equal(urnOf(id), canonicalMrn, `${spelling} mrn`);
    assert.equal(pubidUrnOf(id), canonicalPubidUrn, `${spelling} pubid urn`);
  }
});

test("the part-S-102 URN segment dies on the S-158 family", () => {
  // Neither URN carries a part- or parted- segment for the S-158
  // member any more (pubid#775: the mis-bind emitted parted-0.2.0).
  const id = impl.parse("IHO S-158 Part S-102 0.2.0");
  assert.ok(!urnOf(id).includes("part"), urnOf(id));
  assert.ok(!pubidUrnOf(id).includes("part"), pubidUrnOf(id));
});

test("citation face order never changes identity or URN order", () => {
  const editionFirst = impl.parse("IHO S-158 0.2.0 Part S-102");
  const partFirst = impl.parse("IHO S-158 Part S-102 0.2.0");
  assert.ok(editionFirst.equals!(partFirst));
  assert.equal(urnOf(editionFirst), urnOf(partFirst));
  assert.equal(pubidUrnOf(editionFirst), pubidUrnOf(partFirst));
  // The canonical URN segment order is the declaration order
  // (name with its member, then the edition) regardless of the
  // citation order.
  assert.equal(urnOf(editionFirst), "urn:mrn:iho:pub:spec:s158-102:0.2.0");
});

test("the colon form is the S-158 series device", () => {
  // Another anchor cannot carry the member designator.
  assert.throws(() => impl.parse("IHO S-44:5"));
  assert.throws(() => impl.parse("IHO C-16:2 1.0.0"));
});

test("S-158 rejects a bare colon and a non-numeric member", () => {
  assert.throws(() => impl.parse("IHO S-158:"));
  assert.throws(() => impl.parse("S-158:"));
  assert.throws(() => impl.parse("IHO S-158:abc"));
  assert.throws(() => impl.parse("IHO S-158:abc 1.0.0"));
});

test("the member keeps genuine parts; the modes are exclusive", () => {
  // A bound member keeps a genuine numbered part: the within-edition
  // citation binds the base edition, the separately-published citation
  // the part's own.
  const member = impl.parse("IHO S-158:100 1.0.0 Part 2");
  assert.deepEqual(member.toHash(), {
    _type: "pubid:iho:standard",
    number: "158",
    product: "100",
    edition: "1.0.0",
    part: "2",
  });
  assert.equal(urnOf(member), "urn:mrn:iho:pub:spec:s158-100:1.0.0:part-2");
  const separate = impl.parse("IHO S-158:100 Part 2 1.0.0");
  assert.deepEqual(separate.toHash(), {
    _type: "pubid:iho:standard",
    number: "158",
    product: "100",
    part: "2",
    part_edition: "1.0.0",
  });
  assert.equal(urnOf(separate), "urn:mrn:iho:pub:spec:s158-100:part-2:ed-1.0.0");
  // A base edition and a member/component edition are mutually
  // exclusive.
  assert.throws(() => impl.parse("IHO S-158 0.2.0 Part S-102 1.0.0"));
  assert.throws(() => impl.parse("IHO S-98 1.0.0 Part A 2.0.0"));
});

test("other iho part faces are untouched", () => {
  assert.deepEqual(impl.parse("IHO S-5-B").toHash(), {
    _type: "pubid:iho:standard",
    number: "5",
    part: "B",
  });
  // A lettered part on S-158 is a genuine part (never rebinds).
  assert.deepEqual(impl.parse("IHO S-158 Part A").toHash(), {
    _type: "pubid:iho:standard",
    number: "158",
    part: "A",
  });
  assert.deepEqual(impl.parse("IHO S-98 Part A 1.0.0").toHash(), {
    _type: "pubid:iho:standard",
    number: "98",
    part: "A",
    part_edition: "1.0.0",
  });
});

test("the whole flavor emits the guidance scheme per series", () => {
  // S/P/M carry guidance type codes (spec/per/reg); a component
  // edition rides ed- right after its component, the base year keeps
  // its year- marker, and the appendix hyphen-joins its subnumber.
  assert.equal(urnOf(impl.parse("IHO S-44 5.0.0")), "urn:mrn:iho:pub:spec:s44:5.0.0");
  assert.equal(urnOf(impl.parse("IHO S-100")), "urn:mrn:iho:pub:spec:s100");
  assert.equal(urnOf(impl.parse("IHO S-100 5.0.0 Part 2 (2024)")),
    "urn:mrn:iho:pub:spec:s100:5.0.0:year-2024:part-2");
  assert.equal(urnOf(impl.parse("IHO S-100 1.0.0 Part 4a")),
    "urn:mrn:iho:pub:spec:s100:1.0.0:part-4a");
  assert.equal(urnOf(impl.parse("IHO S-98 Part A 1.0.0")),
    "urn:mrn:iho:pub:spec:s98:part-A:ed-1.0.0");
  assert.equal(urnOf(impl.parse("IHO S-98 Part A 1.0.0 (2024)")),
    "urn:mrn:iho:pub:spec:s98:part-A:ed-1.0.0:year-2024");
  assert.equal(urnOf(impl.parse("IHO S-122 1.0.0 Appendix D-2")),
    "urn:mrn:iho:pub:spec:s122:1.0.0:appendix-D-2");
  assert.equal(urnOf(impl.parse("IHO S-52 4.0.0 Appendix 1")),
    "urn:mrn:iho:pub:spec:s52:4.0.0:appendix-1");
  assert.equal(urnOf(impl.parse("IHO S-66 2.0.0 Sup 4")),
    "urn:mrn:iho:pub:spec:s66:2.0.0:sup-4");
  assert.equal(urnOf(impl.parse("IHO P-1/21 1.0.0")),
    "urn:mrn:iho:pub:per:p1:vol-21:ed-1.0.0");
  assert.equal(urnOf(impl.parse("IHO P-5 2024")),
    "urn:mrn:iho:pub:per:p5:vol-2024");
  assert.equal(urnOf(impl.parse("IHO P-1 Vol. 30 (2)")),
    "urn:mrn:iho:pub:per:p1:vol-30:issue-2");
  assert.equal(urnOf(impl.parse("IHO P-6 Vol. 2 1.0.1")),
    "urn:mrn:iho:pub:per:p6:vol-2:ed-1.0.1");
  assert.equal(urnOf(impl.parse("IHO P-6 1.0.0 Vol. 2")),
    "urn:mrn:iho:pub:per:p6:1.0.0:vol-2");
  assert.equal(urnOf(impl.parse("IHO M-2 Sup 1")), "urn:mrn:iho:pub:reg:m2:sup-1");
  // B/C have no guidance type code: the legacy positional emission.
  assert.equal(urnOf(impl.parse("IHO B-4 2.19.0")), "urn:iho:b:4:ed-2.19.0");
  assert.equal(urnOf(impl.parse("IHO C-13 1.0.0")), "urn:iho:c:13:ed-1.0.0");
  assert.equal(urnOf(impl.parse("IHO B-7 Vol. 2023")), "urn:iho:b:7:vol-2023");
});

test("the S-4 spec citation emits its marker chain", () => {
  assert.equal(urnOf(impl.parse("IHO S-4 4.10.0 B-401")),
    "urn:mrn:iho:pub:spec:s4:4.10.0:part-B:spec-401");
  assert.equal(urnOf(impl.parse("IHO S-4 B-401")),
    "urn:mrn:iho:pub:spec:s4:part-B:spec-401");
  assert.equal(urnOf(impl.parse("IHO S-4 B-122.1")),
    "urn:mrn:iho:pub:spec:s4:part-B:spec-122:specsub-1");
  assert.equal(urnOf(impl.parse("IHO S-4 B-521(I)")),
    "urn:mrn:iho:pub:spec:s4:part-B:spec-521:specvar-I");
});

test("the migrated MRNs re-parse to the canonical identity", () => {
  for (const [urn, human] of [
    ["urn:mrn:iho:pub:spec:s158-102:1.0.0", "IHO S-158:102 1.0.0"],
    ["urn:mrn:iho:pub:spec:s158:1.0.0", "IHO S-158 1.0.0"],
    ["urn:mrn:iho:pub:spec:s158-100", "IHO S-158:100"],
    ["urn:mrn:iho:pub:spec:s44:5.0.0", "IHO S-44 5.0.0"],
    ["urn:mrn:iho:pub:spec:s100:5.0.0:year-2024:part-2", "IHO S-100 5.0.0 Part 2 (2024)"],
    ["urn:mrn:iho:pub:spec:s98:part-A:ed-1.0.0", "IHO S-98 Part A 1.0.0"],
    ["urn:mrn:iho:pub:spec:s122:1.0.0:appendix-D-2", "IHO S-122 1.0.0 Appendix D-2"],
    ["urn:mrn:iho:pub:per:p1:vol-30:issue-2", "IHO P-1 Vol. 30 (2)"],
    ["urn:mrn:iho:pub:reg:m2:sup-1", "IHO M-2 Sup 1"],
    ["urn:mrn:iho:pub:spec:s4:4.10.0:part-B:spec-401", "IHO S-4 4.10.0 B-401"],
  ] as const) {
    const reparsed = impl.parse(urn);
    assert.equal(reparsed.toHuman(), human, urn);
    // URN re-parse round-trips byte-exactly.
    assert.equal(urnOf(reparsed), urn, urn);
  }
});

test("the legacy urn:iho: spellings stay decodable, never emitted for S/P/M", () => {
  assert.equal(impl.parse("urn:iho:s:44:ed-5.0.0").toHuman(), "IHO S-44 5.0.0");
  assert.equal(urnOf(impl.parse("urn:iho:s:44:ed-5.0.0")), "urn:mrn:iho:pub:spec:s44:5.0.0");
  // The bare member segment binds product (the #774 decode).
  assert.equal(impl.parse("urn:iho:s:158:100:ed-1.0.0").toHuman(), "IHO S-158:100 1.0.0");
  assert.equal(
    impl.parse("urn:iho:s:100:ed-1.0.0:year-2024:part-A").toHuman(),
    "IHO S-100 1.0.0 Part A (2024)",
  );
  // The draft-era part URN decodes onto the product identity, canonical
  // colon face (the spelling face drops on decode).
  const decoded = impl.parse("urn:iho:s:158:part-S-102:ed-0.2.0");
  assert.equal(decoded.toHash()["product"], "102");
  assert.equal(decoded.toHuman(), "IHO S-158:102 0.2.0");
  assert.equal(urnOf(decoded), "urn:mrn:iho:pub:spec:s158-102:0.2.0");
  // Unknown junk still rejects.
  assert.throws(() => impl.parse("urn:mrn:iho:pub:spec:s44:junk-1"));
  assert.throws(() => impl.parse("urn:mrn:iho:pub:bathy:s57:1.0.0"));
  assert.throws(() => impl.parse("urn:iho:s:44:nope-1"));
  assert.throws(() => impl.parse("urn:iho:x:1"));
});

test("from_hash unifies the draft-era part model", () => {
  // The draft rows carry ONE edition, wherever it sat.
  const draft = {
    _type: "pubid:iho:standard",
    number: "158",
    part: "S-102",
    part_edition: "0.2.0",
  };
  const id = impl.parse("IHO S-158:102 0.2.0");
  assert.deepEqual(id.fromHash(draft).toHash(), id.toHash());
  const undated = impl.parse("IHO S-158-S-102");
  assert.deepEqual(
    undated.fromHash({
      _type: "pubid:iho:standard",
      number: "158",
      part: "S-102",
    }).toHash(),
    undated.toHash(),
  );
  // A duplicate base/member edition still rejects on the wire.
  assert.throws(() => id.fromHash({
    _type: "pubid:iho:standard",
    number: "158",
    edition: "1.0.0",
    part: "S-102",
    part_edition: "0.2.0",
  }));
});

test("the with-year qualifier rides the S-158 member", () => {
  const id = impl.parse("IHO S-158:102 1.0.0 (2025)");
  assert.equal(id.toHash()["year"], "2025");
  assert.equal(urnOf(id), "urn:mrn:iho:pub:spec:s158-102:1.0.0:year-2025");
  assert.equal(pubidUrnOf(id), "urn:pubid:iho:std:158:product-102:ed-1.0.0:year-2025");
});
