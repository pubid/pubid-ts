import { test } from "node:test";
import assert from "node:assert/strict";
import { BaseIdentifier, registerType } from "../src/model/identifier.js";
import type { IdentifierStatic } from "../src/model/identifier.js";
import { extendAttributes, BASE_ATTRIBUTES, keyValue } from "../src/model/attribute.js";
import { PubidDate, Publisher, Edition } from "../src/model/component.js";
import { BaseUrnGenerator } from "../src/model/urn-generator.js";
import { BaseBuilder } from "../src/model/builder.js";

// Pins for the unified model core (TODO.unified/01). The corpus gate
// proves the same semantics end-to-end per flavor; these tests pin the
// CORE in isolation.

class Probe extends BaseIdentifier {
  static polymorphicName = "pubid:probe:doc";
  render(): string {
    return "probe";
  }
  static attributes = extendAttributes(BaseIdentifier, {
    ...BASE_ATTRIBUTES,
    tag: { type: "string", default: "x" },
  });
}
registerType(Probe as unknown as IdentifierStatic);

test("canonical hash drops empty and default-valued attributes", () => {
  const p = new Probe({ number: "5", all_parts: false, tag: "x" });
  assert.deepEqual(p.toHash(), { _type: "pubid:probe:doc", number: "5" });
});

test("degenerate date flattens and RENAMES to year; edition collapses in place", () => {
  const dated = new Probe({ number: "1", date: new PubidDate({ year: "2024" }) });
  assert.deepEqual(dated.toHash(), {
    _type: "pubid:probe:doc",
    number: "1",
    year: "2024",
  });
  // A month makes the date non-degenerate: it stays a nested hash.
  const monthed = new Probe({ number: "1", date: new PubidDate({ year: "2024", month: "7" }) });
  assert.deepEqual(monthed.toHash(), {
    _type: "pubid:probe:doc",
    number: "1",
    date: { year: "2024", month: "7" },
  });
  const ed = new Probe({ number: "1", edition: new Edition({ number: "2" }) });
  assert.deepEqual(ed.toHash(), { _type: "pubid:probe:doc", number: "1", edition: "2" });
});

test("copublishers are not in the flat table: they stay nested", () => {
  const p = new Probe({
    number: "1",
    copublishers: [new Publisher({ body: "ASME" })],
  });
  assert.deepEqual(p.toHash(), {
    _type: "pubid:probe:doc",
    number: "1",
    copublishers: [{ body: "ASME" }],
  });
});

test("fromHash dispatches on _type and round-trips", () => {
  const hash = { _type: "pubid:probe:doc", number: "1", year: "2024" };
  const p = Probe.fromHash(hash);
  const fields = p as unknown as Record<string, unknown>;
  assert.ok(fields["date"] instanceof PubidDate);
  assert.equal((fields["date"] as PubidDate).year, "2024");
  assert.deepEqual(p.toHash(), hash);
});

test("custom mapping converters drive the wire shape", () => {
  class Mapped extends BaseIdentifier {
    static polymorphicName = "pubid:probe:mapped";
    render(): string {
      return "mapped";
    }
    static attributes = extendAttributes(Probe, {
      date: { type: PubidDate },
      month_str: { type: "string" },
    });
    static mappings = keyValue(
      {
        wire: "year",
        to: "date",
        toWire: (m) => (m["date"] as PubidDate).render(),
        fromWire: (h) => new PubidDate({ year: String(h["year"]) }),
      },
      { wire: "month", to: "month_str" },
    );
  }
  registerType(Mapped as unknown as IdentifierStatic);
  const m = new Mapped({ date: new PubidDate({ year: "2018" }) });
  assert.deepEqual(m.toHash(), { _type: "pubid:probe:mapped", year: "2018" });
});

// BaseUrnGenerator derives parts from DECLARED attributes only — the
// shapes Ruby's base generator produces for doi (no slots), isbn, and
// omg (part slot) are pinned here with their declaration tables.
class DoiLike extends BaseIdentifier {
  static polymorphicName = "pubid:doi:resource";
  render(): string {
    return "doi";
  }
  static attributes = extendAttributes(BaseIdentifier, {
    ...BASE_ATTRIBUTES,
    number: { type: "string" },
    prefix: { type: "string" },
    suffix: { type: "string" },
  });
}
class OmgLike extends BaseIdentifier {
  static polymorphicName = "pubid:omg:specification";
  render(): string {
    return "omg";
  }
  static attributes = extendAttributes(BaseIdentifier, {
    ...BASE_ATTRIBUTES,
    acronym: { type: "string" },
    version: { type: "string" },
    part: { type: "string" },
  });
}

test("BaseUrnGenerator derives the base-generator flavors' URNs", () => {
  assert.equal(
    new BaseUrnGenerator(new DoiLike({ prefix: "10.9999", suffix: "abc" })).generate(),
    "urn:doi",
  );
  assert.equal(
    new BaseUrnGenerator(new OmgLike({ acronym: "DDS", version: "1.4", part: "PDF" })).generate(),
    "urn:omg:-PDF",
  );
  assert.equal(
    new BaseUrnGenerator(new OmgLike({ acronym: "CORBA" })).generate(),
    "urn:omg",
  );
});

test("BaseBuilder assigns declared keys through cast and skips unknowns", () => {
  class Built extends Probe {
    render(): string {
      return "built";
    }
  }
  registerType(Built as unknown as IdentifierStatic);
  class Builder extends BaseBuilder {
    protected defaultIdentifierClass() {
      return Built as unknown as IdentifierStatic;
    }
    protected cast(key: string, value: unknown): unknown {
      if (key === "copub") {
        return { copublishers: [new Publisher({ body: String(value) })] };
      }
      return value;
    }
  }
  const id = new Builder().build({ number: "9", junk: "ignored", copub: "ASME" }) as Built;
  assert.deepEqual(id.toHash(), {
    _type: "pubid:probe:doc",
    number: "9",
    copublishers: [{ body: "ASME" }],
  });
});
