import { BaseIdentifier, registerType } from "../../model/identifier.js";
import type { IdentifierStatic } from "../../model/identifier.js";
import { extendAttributes } from "../../model/attribute.js";
import { PubidDate } from "../../model/component.js";
import { BaseUrnGenerator } from "../../model/urn-generator.js";

/**
 * The ansi identifier model — lib/pubid/ansi/identifier.rb plus its
 * Identifiers::* leaves. Registration lives HERE (parg-free) so the
 * worker manifest (src/flavors/register-types.ts) can import it without
 * reaching the artifact runtime; the parse entry (./index.js) is the
 * parg-backed half.
 *
 * The relaton#45 round: any uppercase developer acronym co-publishes,
 * the publisher group may join the number with a dash
 * (number_separator), the year may join the number with a dash
 * (date_separator — the "ANSI X9.62-2005" spelling), and a trailing
 * revision letter ("ANSI/TIA-568.2-D") is identity. Both separators are
 * spelling-only facets: they serialize but `==` skips them
 * (equality_ignored).
 */

/**
 * The URN generator (lib/pubid/ansi/urn_generator.rb): the namespace
 * slot carries the publisher and copublishers joined with dashes
 * ("ansi-tia"), the revision is identity so it reaches the URN too
 * ("rev-D").
 */
class AnsiUrnGenerator extends BaseUrnGenerator<AnsiIdentifier> {
  generate(): string {
    const id = this.identifier;
    const parts = ["urn", "ansi"];
    const push = (v: string | undefined) => {
      if (v !== undefined && v !== null && v !== "") parts.push(v);
    };
    push(this.urnNumber());
    push(this.urnPart());
    push(this.urnSubpart());
    push(this.urnYear());
    // "568.2-C" and "568.2-D" are two documents: keep them apart.
    push(id.revision !== undefined ? `rev-${id.revision}` : undefined);
    push(this.urnEdition());

    if (id.publisher !== undefined) {
      parts[1] = id.publisher.body.toLowerCase();
    }
    if (id.copublishers !== undefined && id.copublishers.length > 0) {
      const copubs = id.copublishers.map((cp) => cp.body.toLowerCase());
      parts[1] = `${parts[1]}-${copubs.join("-")}`;
    }
    if (id.languages !== undefined && id.languages.length > 0) {
      parts.push(id.languages.map((l) => l.code).join(","));
    }
    return parts.join(":");
  }
}

/** The base ANSI identifier (Pubid::Ansi::Identifier): render, URN and
 *  hash behavior shared by every leaf. */
export class AnsiIdentifier extends BaseIdentifier {
  static polymorphicName = "pubid:ansi:identifier";
  static attributes = extendAttributes(BaseIdentifier, {
    date_separator: { type: "string", equalityIgnored: true },
    number_separator: { type: "string", equalityIgnored: true },
    revision: { type: "string" },
  });
  // The gem declares no key_value block: every attribute serializes
  // under its own name (the date component's degenerate year flattens).
  static urnGenerator = AnsiUrnGenerator;

  declare readonly number: string | undefined;
  declare readonly part: string | undefined;
  declare readonly date: PubidDate | undefined;
  declare readonly date_separator: string | undefined;
  declare readonly number_separator: string | undefined;
  declare readonly revision: string | undefined;
  declare readonly publisher: { body: string } | undefined;
  declare readonly copublishers: { body: string }[] | undefined;
  declare readonly languages: { code: string }[] | undefined;

  render(): string {
    // The renderer (lib/pubid/ansi/renderer.rb): "ANSI/ISA-5.1-2009"
    // keeps its dash; the space is the default publisher join.
    const publisherPortion =
      this.copublishers !== undefined && this.copublishers.length > 0
        ? [this.publisher, ...this.copublishers]
            .map((p) => (p === undefined ? "" : p.body))
            .join("/")
        : this.publisher?.body ?? "";
    const numberPortion =
      (this.number ?? "") +
      (this.part !== undefined ? `-${this.part}` : "") +
      (this.revision !== undefined ? `-${this.revision}` : "") +
      // "ANSI X9.62-2005" keeps its dash; the colon is the default.
      (this.datePresent() ? `${this.date_separator ?? ":"}${this.date?.year}` : "");
    let result = this.number_separator !== undefined
      ? `${publisherPortion}${this.number_separator}${numberPortion}`
      : `${publisherPortion} ${numberPortion}`;
    if (this.languages !== undefined && this.languages.length > 0) {
      result += `(${this.languages.map((l) => l.code).join(",")})`;
    }
    return result;
  }

  private datePresent(): boolean {
    const date = this.date;
    if (date === undefined) return false;
    if (date.undated) return true;
    return date.year !== undefined && date.year !== "";
  }
}

/** Identifiers::Standard — the default leaf every parse builds. */
export class AnsiStandard extends AnsiIdentifier {
  static polymorphicName = "pubid:ansi:standard";
}

/** Identifiers::AmericanNationalStandard — the explicit ANS type. */
export class AnsiAmericanNationalStandard extends AnsiIdentifier {
  static polymorphicName = "pubid:ansi:american-national-standard";
}

// The ANSI_TYPE_MAP role: the base plus the two concrete leaves (the
// schema's pubid:ansi:{identifier,standard,american-national-standard}).
registerType(AnsiIdentifier as unknown as IdentifierStatic);
registerType(AnsiStandard as unknown as IdentifierStatic);
registerType(AnsiAmericanNationalStandard as unknown as IdentifierStatic);
