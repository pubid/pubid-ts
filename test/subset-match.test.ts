import { test } from "node:test";
import assert from "node:assert/strict";
import { BaseIdentifier } from "../src/model/identifier.js";
import { subsetMatch } from "../src/model/subset-match.js";
import { isoGrammarImplementation } from "../src/flavors/iso/index.js";
import { iecGrammarImplementation } from "../src/flavors/iec/index.js";

// Registers iso/iec types in the _type registry on import.
void isoGrammarImplementation;
void iecGrammarImplementation;

const iso = isoGrammarImplementation();
const iec = iecGrammarImplementation();

// The lean-hash rows mirror relaton's conformance/retrieval/index-v2.yaml
// (the shared retrieval conformance pack); the cases are its expectations.
const rows = [
  { _type: "pubid:iso:international-standard", publisher: "ISO", number: "9001", year: 2015 },
  { _type: "pubid:iso:international-standard", publisher: "ISO", number: "9001", year: 2026 },
  { _type: "pubid:iso:international-standard", publisher: "ISO", number: "9001", part: "1", year: 2025 },
  { _type: "pubid:iec:international-standard", publisher: "IEC CA", number: "01", year: 2016 },
  { _type: "pubid:iec:international-standard", publisher: "IEC CA", number: "01", year: 2017 },
  {
    _type: "pubid:iec:vap-identifier",
    base: { _type: "pubid:iec:international-standard", publisher: "IEC CA", number: "01", year: 2020 },
    vap: ["CSV"],
  },
  { _type: "pubid:iso:international-standard", publisher: "ISO", number: "1111", year: 2020 },
  { _type: "pubid:iec:international-standard", publisher: "IEC", number: "1111", year: 2021 },
  {
    _type: "pubid:iso:amendment",
    base: { _type: "pubid:iso:international-standard", publisher: "ISO", number: "9001", year: 2015 },
    amendment: { stage: "Amd", number: "1", year: 2022 },
  },
].map((h) => BaseIdentifier.fromHash(h));

function filesMatching(query: string): string[] {
  const impl = query.startsWith("IEC") ? iec : iso;
  // Canonicalize the query into the model layer through its own hash.
  const ref = BaseIdentifier.fromHash(impl.parse(query).toHash());
  return rows
    .map((r, i) => (subsetMatch(ref, r) ? `data/row-${i}.yaml` : null))
    .filter((f): f is string => f !== null);
}

test("dated query hits its edition only; the amendment is a separate document", () => {
  assert.deepEqual(filesMatching("ISO 9001:2015"), ["data/row-0.yaml"]);
});

test("undated query spans editions and parts, not the amendment layer", () => {
  assert.deepEqual(filesMatching("ISO 9001"), ["data/row-0.yaml", "data/row-1.yaml", "data/row-2.yaml"]);
});

test("part disambiguates within the family", () => {
  assert.deepEqual(filesMatching("ISO 9001-1"), ["data/row-2.yaml"]);
});

test("cross-publisher number collision stays disjoint", () => {
  assert.deepEqual(filesMatching("IEC 1111:2021"), ["data/row-7.yaml"]);
});

test("base queries never reach the supplement wrapper", () => {
  assert.deepEqual(filesMatching("IEC CA 01"), ["data/row-3.yaml", "data/row-4.yaml"]);
  assert.deepEqual(filesMatching("IEC CA 01:2020"), []);
});

test("delivery-qualified query matches the wrapper exactly", () => {
  assert.deepEqual(filesMatching("IEC CA 01:2020 CSV"), ["data/row-5.yaml"]);
});
