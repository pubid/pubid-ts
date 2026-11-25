import { test } from "node:test";
import assert from "node:assert/strict";
import { grammarImplementation } from "../src/flavors/index.js";

// The IHO S-158 series model (pubid#774) and the URN defect fixes
// (pubid#775), plus the whole-flavor MRN migration to the IHO MRN
// guidance scheme (urn:mrn:iho:pub:spec:...).
//
// checks_for is the typed facet for the S-100 product number whose
// validation checks the publication specifies. "S-158:<NNN>" is the
// PRIMARY designator form (number=158, checks_for=NNN — never an
// opaque number, never a part); the legacy draft-era spellings
// "S-158 Part S-102" / "S-158-S-102" bind the SAME identity as
// non-normalized aliases: render keeps the input spelling, equality
// and both URNs use the canonical shape, and the citation face order
// never moves identity or URN segments (the pubid#775 mis-bind — the
// trailing edition gluing into part_edition, parted-0.2.0 — dies with
// the part capture).

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
    checks_for: "102",
    edition: "1.0.0",
  });
  // The human face keeps the colon spelling.
  assert.equal(id.toHuman(), "IHO S-158:102 1.0.0");
  // MRN: the checks member hyphenates into the name segment, the
  // edition keeps its canonical position (the guidance's <edition
  // number> slot).
  assert.equal(id.toUrn(), "urn:mrn:iho:pub:spec:s158-102:1.0.0");
  // pubid-URN: the typed checks- atom precedes the edition.
  assert.equal(pubidUrnOf(id), "urn:pubid:iho:std:158:checks-102:ed-1.0.0");
});

test("the checks member covers every S-100 product number", () => {
  for (const [input, member] of [
    ["IHO S-158:100 1.0.0", "100"],
    ["IHO S-158:98 1.0.0", "98"],
    ["IHO S-158:128 1.0.0", "128"],
  ] as const) {
    const id = impl.parse(input);
    assert.equal(id.toHash()["checks_for"], member);
    assert.equal(id.toHash()["number"], "158");
    assert.equal(id.toUrn(), `urn:mrn:iho:pub:spec:s158-${member}:1.0.0`);
    assert.equal(pubidUrnOf(id), `urn:pubid:iho:std:158:checks-${member}:ed-1.0.0`);
  }
});

test("the S-158 framework publication has no checks member", () => {
  const id = impl.parse("IHO S-158 1.0.0");
  assert.deepEqual(id.toHash(), {
    _type: "pubid:iho:standard",
    number: "158",
    edition: "1.0.0",
  });
  assert.equal(id.toUrn(), "urn:mrn:iho:pub:spec:s158:1.0.0");
  assert.equal(pubidUrnOf(id), "urn:pubid:iho:std:158:ed-1.0.0");
});

test("legacy draft-era spellings bind the same identity", () => {
  // "Part S-102" (the draft citation face) and the compact
  // "S-158-S-102" parse to checks_for=102 — never a part, never a
  // parted- edition.
  const part = impl.parse("IHO S-158 0.2.0 Part S-102");
  assert.deepEqual(part.toHash(), {
    _type: "pubid:iho:standard",
    number: "158",
    checks_for: "102",
    edition: "0.2.0",
  });
  const compact = impl.parse("IHO S-158-S-102 0.2.0");
  assert.deepEqual(compact.toHash(), part.toHash());
  // The mis-bound spelling ("Part S-102 <edition>") folds its edition
  // onto the base: same identity, no part_edition capture.
  const misbound = impl.parse("IHO S-158 Part S-102 0.2.0");
  assert.deepEqual(misbound.toHash(), part.toHash());
  // ...and the colon spelling is the same document.
  const colon = impl.parse("IHO S-158:102 0.2.0");
  assert.ok(part.equals!.call(part, misbound));
  assert.ok(part.equals!(colon));
  assert.ok(misbound.equals!(colon));
});

test("render keeps the input spelling; URNs stay canonical", () => {
  assert.equal(impl.parse("IHO S-158:102 0.2.0").toHuman(), "IHO S-158:102 0.2.0");
  assert.equal(impl.parse("IHO S-158 0.2.0 Part S-102").toHuman(), "IHO S-158 0.2.0 Part S-102");
  // The compact face renders expanded (the S-5A law).
  assert.equal(impl.parse("IHO S-158-S-102 0.2.0").toHuman(), "IHO S-158 0.2.0 Part S-102");
  const canonicalMrn = "urn:mrn:iho:pub:spec:s158-102:0.2.0";
  const canonicalPubidUrn = "urn:pubid:iho:std:158:checks-102:ed-0.2.0";
  for (const spelling of [
    "IHO S-158:102 0.2.0",
    "IHO S-158 0.2.0 Part S-102",
    "IHO S-158 Part S-102 0.2.0",
    "IHO S-158-S-102 0.2.0",
  ]) {
    const id = impl.parse(spelling);
    assert.equal(id.toUrn(), canonicalMrn, `${spelling} mrn`);
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
  assert.equal(editionFirst.toUrn(), partFirst.toUrn());
  assert.equal(pubidUrnOf(editionFirst), pubidUrnOf(partFirst));
  // The canonical URN segment order is the declaration order
  // (member, then edition) regardless of the citation order.
  assert.equal(editionFirst.toUrn(), "urn:mrn:iho:pub:spec:s158-102:0.2.0");
});

test("S-158 rejects a bare colon and a non-numeric member", () => {
  assert.throws(() => impl.parse("IHO S-158:"));
  assert.throws(() => impl.parse("S-158:"));
  assert.throws(() => impl.parse("IHO S-158:abc"));
  assert.throws(() => impl.parse("IHO S-158:abc 1.0.0"));
});

test("other iho part faces are untouched", () => {
  // A numbered part on S-158 stays a part (only the series-reference
  // faces re-key), and other series keep their parts.
  assert.deepEqual(impl.parse("IHO S-158 1.0.0 Part 2").toHash(), {
    _type: "pubid:iho:standard",
    number: "158",
    edition: "1.0.0",
    part: "2",
  });
  assert.deepEqual(impl.parse("IHO S-5-B").toHash(), {
    _type: "pubid:iho:standard",
    number: "5",
    part: "B",
  });
  assert.deepEqual(impl.parse("IHO S-98 Part A 1.0.0").toHash(), {
    _type: "pubid:iho:standard",
    number: "98",
    part: "A",
    part_edition: "1.0.0",
  });
});

test("the colon number stays opaque outside the S-158 family", () => {
  const id = impl.parse("IHO C-16:2 1.0.0");
  assert.equal(id.toHash()["number"], "16:2");
  assert.equal(id.toHash()["checks_for"], undefined);
  // The compound number hyphenates into the MRN name segment (the
  // fleet extension, pubid#774); the colon face is preserved.
  assert.equal(id.toHuman(), "IHO C-16:2 1.0.0");
  assert.equal(id.toUrn(), "urn:mrn:iho:pub:spec:c16-2:1.0.0");
});

test("the whole flavor emits the urn:mrn:iho guidance scheme", () => {
  // Standards: dotted edition in the canonical slot.
  assert.equal(impl.parse("IHO S-44 5.0.0").toUrn(), "urn:mrn:iho:pub:spec:s44:5.0.0");
  // The with-year qualifier and a part: trailing tokens, canonical
  // order regardless of the citation order.
  assert.equal(impl.parse("IHO S-100 5.0.0 Part 2 (2024)").toUrn(),
    "urn:mrn:iho:pub:spec:s100:5.0.0:year2024:part2");
  // The separately-published part carries its edition right after its
  // token.
  assert.equal(impl.parse("IHO S-98 Part A 1.0.0").toUrn(),
    "urn:mrn:iho:pub:spec:s98:partA:1.0.0");
  assert.equal(impl.parse("IHO S-98 Part A 1.0.0 (2024)").toUrn(),
    "urn:mrn:iho:pub:spec:s98:partA:1.0.0:year2024");
  // The slash chain is the volume's short face; the yearbook year a
  // volume.
  assert.equal(impl.parse("IHO P-1/21 1.0.0").toUrn(),
    "urn:mrn:iho:pub:spec:p1:vol21:1.0.0");
  assert.equal(impl.parse("IHO B-7 Vol. 2023").toUrn(),
    "urn:mrn:iho:pub:spec:b7:vol2023");
  // Supplement (the guidance's own example shape), annex, appendix
  // with its bare subnumber child.
  assert.equal(impl.parse("IHO M-2 Sup 1").toUrn(),
    "urn:mrn:iho:pub:spec:m2:supplement1");
  assert.equal(impl.parse("IHO S-66 2.0.0 Sup 4").toUrn(),
    "urn:mrn:iho:pub:spec:s66:2.0.0:supplement4");
  assert.equal(impl.parse("IHO S-122 1.0.0 Appendix D-2").toUrn(),
    "urn:mrn:iho:pub:spec:s122:1.0.0:appendixD:2");
  // The S-4 spec citation: the spec token shaped like the printed
  // face, the citation letter riding it.
  assert.equal(impl.parse("IHO S-4 4.10.0 B-401").toUrn(),
    "urn:mrn:iho:pub:spec:s4:4.10.0:partB:spec401");
  assert.equal(impl.parse("IHO S-4 B-351.1(I)").toUrn(),
    "urn:mrn:iho:pub:spec:s4:partB:spec351.1(I)");
});

test("the migrated MRNs re-parse to the same identity", () => {
  for (const [urn, input] of [
    ["urn:mrn:iho:pub:spec:s158-102:1.0.0", "IHO S-158:102 1.0.0"],
    ["urn:mrn:iho:pub:spec:s158:1.0.0", "IHO S-158 1.0.0"],
    ["urn:mrn:iho:pub:spec:s44:5.0.0", "IHO S-44 5.0.0"],
    ["urn:mrn:iho:pub:spec:s100:5.0.0:year2024:part2", "IHO S-100 5.0.0 Part 2 (2024)"],
    ["urn:mrn:iho:pub:spec:s98:partA:1.0.0", "IHO S-98 Part A 1.0.0"],
    ["urn:mrn:iho:pub:spec:p1:vol21:1.0.0", "IHO P-1 Vol. 21 1.0.0"],
    ["urn:mrn:iho:pub:spec:c16-2:1.0.0", "IHO C-16:2 1.0.0"],
    ["urn:mrn:iho:pub:spec:m2:supplement1", "IHO M-2 Sup 1"],
    ["urn:mrn:iho:pub:spec:s122:1.0.0:appendixD:2", "IHO S-122 1.0.0 Appendix D-2"],
    ["urn:mrn:iho:pub:spec:s4:4.10.0:partB:spec401", "IHO S-4 4.10.0 B-401"],
  ] as const) {
    const reparsed = impl.parse(urn);
    assert.equal(reparsed.toHuman(), input, urn);
    // URN re-parse round-trips byte-exactly.
    assert.equal(reparsed.toUrn(), urn, urn);
  }
});

test("the legacy urn:iho: spellings stay decodable, never emitted", () => {
  assert.equal(impl.parse("urn:iho:s:44:ed-5.0.0").toHuman(), "IHO S-44 5.0.0");
  // The legacy emission re-emits in the migrated scheme.
  assert.equal(impl.parse("urn:iho:s:44:ed-5.0.0").toUrn(), "urn:mrn:iho:pub:spec:s44:5.0.0");
  // The old #637 colon-number spellings decode.
  assert.equal(impl.parse("urn:iho:s:158:100:ed-1.0.0").toHuman(), "IHO S-158:100 1.0.0");
  assert.equal(
    impl.parse("urn:iho:s:100:ed-1.0.0:year-2024:part-A").toHuman(),
    "IHO S-100 1.0.0 Part A (2024)",
  );
  // Unknown junk still rejects.
  assert.throws(() => impl.parse("urn:mrn:iho:pub:spec:s44:junk-1"));
  assert.throws(() => impl.parse("urn:iho:s:44:nope-1"));
});

test("the with-year qualifier rides the S-158 member", () => {
  const id = impl.parse("IHO S-158:102 1.0.0 (2025)");
  assert.equal(id.toHash()["year"], "2025");
  assert.equal(id.toUrn(), "urn:mrn:iho:pub:spec:s158-102:1.0.0:year2025");
  assert.equal(pubidUrnOf(id), "urn:pubid:iho:std:158:checks-102:ed-1.0.0:year-2025");
});
