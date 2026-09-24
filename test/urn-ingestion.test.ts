import { test } from "node:test";
import assert from "node:assert/strict";
import { grammarImplementation } from "../src/flavors/index.js";

// pubid/pubid-ts#1: URN ingestion. parse(toUrn()) must round-trip for
// flavors whose Ruby reference implements a URN parser (oiml); the rest
// name themselves in a not-yet-supported error.

test("oiml ingests its own URNs", () => {
  const impl = grammarImplementation("oiml")!;
  const id = impl.parse("OIML R 117-1");
  const reparsed = impl.parse(id.toUrn()!);
  assert.equal(reparsed.toHuman(), "OIML R 117-1");
  assert.equal(reparsed.toUrn(), id.toUrn());
});

test("oiml URN ingestion mirrors the reference: type token + locator", () => {
  const impl = grammarImplementation("oiml")!;
  assert.equal(impl.parse("urn:oiml:r:117-1:2019").toHuman(), "OIML R 117-1");
  assert.equal(impl.parse("urn:oiml:bulletin:2026-02-11").toHuman(), "OIML Bulletin 2026-02-11");
});

test("flavors without a URN parser reject URN input through their grammar", () => {
  const impl = grammarImplementation("iso")!;
  assert.throws(() => impl.parse("urn:iso:std:iso:8601:2004"));
});
