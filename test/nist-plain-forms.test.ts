import { test } from "node:test";
import assert from "node:assert/strict";
import { grammarImplementation } from "../src/flavors/index.js";

// The default-series plain-number branch (pubid#711, Ruby side released
// in 2.0.23): the grammar's two trailing identifier alternatives accept
// the series-less report-number forms — the bare docnumber ("800-90B")
// and its publisher-led spelling ("NIST 800-90B") — and the Builder
// defaults them onto the SpecialPublication identity (default_series
// "SP", series_default_publisher "NIST", the #704 fill shape), so the
// docnumber-shaped citation parses onto the same identity as the
// spelled "NIST SP 800-90B" form.

const impl = grammarImplementation("nist")!;

/** Strip the equality-ignored spelling facet (Ruby equality_ignored
 *  :publisher_was_parsed) so two spellings of one identity compare. */
function identityOf(id: ReturnType<typeof impl.parse>): Record<string, unknown> {
  const { publisher_was_parsed: _flag, ...rest } = id.toHash();
  return rest;
}

test("the plain forms converge onto one SP identity", () => {
  const bare = impl.parse("800-90B");
  const led = impl.parse("NIST 800-90B");
  const spelled = impl.parse("NIST SP 800-90B");

  // One class, one series, one publisher.
  for (const id of [bare, led, spelled]) {
    assert.equal(id.toHash()["_type"], "pubid:nist:special-publication");
    assert.equal(id.toHash()["series"], "SP");
    assert.equal(id.toHash()["publisher"], "NIST");
    assert.equal(id.toHash()["number"], "800-90");
  }

  // The publisher-led spelling IS the spelled form (byte-equal hash —
  // both spelled their publisher, so the flag stays default-true and
  // drops from the wire).
  assert.deepEqual(led.toHash(), spelled.toHash());
  assert.equal(led.toHuman(), "NIST SP 800-90B");

  // The bare parse carries the same identity; only the recorded
  // spelling facet differs (publisher_was_parsed: false), which Ruby's
  // equality ignores. Everything identity-bearing — hash minus the
  // flag, URN, MR face — is byte-identical.
  assert.deepEqual(identityOf(bare), identityOf(spelled));
  assert.equal(bare.toHash()["publisher_was_parsed"], false);
  assert.equal(bare.toHuman(), "SP 800-90B");
  for (const id of [bare, led, spelled]) {
    assert.equal(id.toUrn(), "urn:nist:sp:800-90.B.supp");
    const mr = (id.constructor as unknown as { fromHash: (h: Record<string, unknown>) => typeof id }).fromHash({
      ...id.toHash(),
      parsed_format: "mr",
    });
    assert.equal(mr.render(), "NIST.SP.800-90B");
  }

  // The MR spelling itself parses onto the same identity.
  assert.equal(impl.parse("NIST.SP.800-90B").render(), "NIST.SP.800-90B");
});

test("the 800-53 family rides the same default", () => {
  const bare = impl.parse("800-53");
  const led = impl.parse("NIST 800-53");
  const spelled = impl.parse("NIST SP 800-53");
  assert.equal(bare.toHuman(), "SP 800-53");
  assert.equal(led.toHuman(), "NIST SP 800-53");
  assert.deepEqual(led.toHash(), spelled.toHash());
  assert.deepEqual(identityOf(bare), identityOf(spelled));
  assert.equal(bare.toHash()["subseries"], "800");
  assert.equal(led.toHash()["subseries"], "800");
});

test("the dated branch keeps priority over the publisher-led plain form", () => {
  // The dated ISO-date alternative stays ahead of the new
  // (publisher) (report_number) branch: the dated NBS bulletins keep
  // their DatedDocument dispatch.
  const dated = impl.parse("NIST 2023-04-15 001");
  assert.equal(dated.toHash()["_type"], "pubid:nist:dated-document");
  assert.equal(dated.toHuman(), "NIST 2023-04-15 001");
});

test("the FIPS face and the #700 aliases stay byte-intact", () => {
  assert.equal(impl.parse("FIPS PUB 205").toHuman(), "FIPS PUB 205");
  assert.equal(impl.parse("NIST FIPS PUB 205").toHuman(), "FIPS PUB 205");
  assert.equal(impl.parse("FIPS 197").toHuman(), "FIPS 197");
  assert.equal(impl.parse("NBS FIPS 46").toHuman(), "NBS FIPS 46");
});

test("publisher-led wrong-org series spellings still reject", () => {
  // The new branch accepts only the report-number tail after the
  // publisher; series-token spellings the grammar never accepted keep
  // raising (the #712 replay's error→error set keeps its shape).
  assert.throws(() => impl.parse("NIST CIS 123"));
  assert.throws(() => impl.parse("NIST SP"));
  assert.throws(() => impl.parse("800-90B nonsense-tail"));
});
