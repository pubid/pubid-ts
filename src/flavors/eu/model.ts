import { BaseIdentifier, registerType } from "../../model/identifier.js";
import type { IdentifierStatic } from "../../model/identifier.js";
import { extendAttributes, keyValue } from "../../model/attribute.js";
import type { PubidDate } from "../../model/component.js";

/**
 * The eu identifier model — the classes of lib/pubid/eu/identifiers.rb.
 * Registration lives HERE (parg-free) so the worker manifest
 * (src/flavors/register-types.ts) can import it without reaching the
 * artifact runtime; the parse entry (./index.js) is the parg-backed half.
 *
 * Identity is the leaf class (the act type), the year (`date`) and the
 * `number` — the three parts of a CELEX number. `family` is the
 * bracketed legal family of the Official Journal form ("(EU)", "(EC)"
 * ...); the canonical reference omits it, so a reference with no family
 * matches a row that has one (the subset-match wildcard).
 * `number_first` is the print ORDER of the two numbers — spelling, not
 * identity: it serializes but `==` skips it (equality_ignored), so
 * "EU Decision 1082/2013" equals the CELEX number 32013D1082.
 */

/** The act-type metadata each leaf class carries (Ruby self.type). */
export interface EuType {
  key: string;
  title: string;
  celex: string | null;
  eli: string | null;
}

/** From 2015 every act prints <year>/<number>; before it, a regulation
 *  printed <number>/<year> (the first Official Journal acts, ECSC,
 *  date from 1952). */
export const FIXED_ORDER_YEAR = 2015;
/** The canonical reference's publisher — the PUBLISHER constant, not an
 *  attribute: every surface prints it, so nothing stores it. */
export const EU_PUBLISHER = "EU";

export class EuIdentifier extends BaseIdentifier {
  static polymorphicName = "pubid:eu:identifier";
  static attributes = extendAttributes(BaseIdentifier, {
    family: { type: "string" },
    number_first: { type: "boolean", equalityIgnored: true },
  });
  // The gem's key_value whitelist: only the four slots hit the wire; the
  // base's part/edition/publisher/... slots stay off it.
  static mappings = keyValue(
    { wire: "number", to: "number" },
    { wire: "date", to: "date" },
    { wire: "family", to: "family" },
    { wire: "number_first", to: "number_first" },
  );

  static euType: EuType = { key: "identifier", title: "", celex: null, eli: null };

  declare readonly number: string | undefined;
  declare readonly date: PubidDate | undefined;
  declare readonly family: string | undefined;
  declare readonly number_first: boolean | undefined;

  /** The year, read off the date component (Ruby #year). */
  get year(): string | undefined {
    return this.date?.year;
  }

  /** A regulation with a year before 2015 prints <number>/<year>;
   *  everything else prints <year>/<number>. (Ruby year.to_i: a missing
   *  year reads as 0, so a year-less regulation defaults number-first.) */
  defaultNumberFirst(): boolean {
    return this.euTypeKey() === "regulation" &&
      (Number(this.year) || 0) < FIXED_ORDER_YEAR;
  }

  /** The effective print order: the stored flag when the builder set it
   *  (the input used the non-default order), else the default rule. */
  numberFirst(): boolean {
    return this.number_first ?? this.defaultNumberFirst();
  }

  /** The act-type key of the leaf class ("regulation" / "directive" /
   *  "decision" / the base's "identifier"). */
  euTypeKey(): string {
    return (this.constructor as unknown as { euType: EuType }).euType.key;
  }

  /** The act-type title of the leaf class ("" on the base). */
  euTitle(): string {
    return (this.constructor as unknown as { euType: EuType }).euType.title;
  }

  /** The CELEX type letter of the leaf class (R / L / D). */
  euCelexLetter(): string | null {
    return (this.constructor as unknown as { euType: EuType }).euType.celex;
  }

  /** The ELI segment of the leaf class (reg / dir / dec). */
  euEliSegment(): string | null {
    return (this.constructor as unknown as { euType: EuType }).euType.eli;
  }

  render(): string {
    return `${EU_PUBLISHER} ${this.euTitle()} ${this.numbers()}`;
  }

  /** to_s(with_publisher: false): the Official-Journal-citable form
   *  without the leading "EU " (the PublisherStripper cut). */
  toHuman(opts?: { withPublisher?: boolean }): string {
    const human = super.toHuman();
    if (opts?.withPublisher !== false) return human;
    return human.replace(/^EU(?<sep>\s+)/, "");
  }

  /** The CELEX number: sector 3, year, type letter, number padded to 4.
   *  (The base class carries no type letter — the segments join empty.) */
  toCelex(): string {
    return `3${this.year ?? ""}${this.euCelexLetter() ?? ""}${(this.number ?? "").padStart(4, "0")}`;
  }

  /** The ELI of the act as published in the Official Journal. */
  toEli(): string {
    return `http://data.europa.eu/eli/${this.euEliSegment() ?? ""}/${this.year ?? ""}/${this.number ?? ""}/oj`;
  }

  /** The EU has no registered URN namespace (the ELI is its official
   *  identifier). This pubid-invented form keeps the act type, so a
   *  regulation and a decision with the same numbers do not collide. */
  toUrn(): string {
    return `urn:eu:${this.euEliSegment() ?? ""}:${this.year ?? ""}:${this.number ?? ""}`;
  }

  /** The two numbers in print order, or the bare number without a year.
   *  When the plain pair would read back as ANOTHER act (two acts share
   *  one plain print — 32015R2014 and 32014R2015 both give "2015/2014"),
   *  "No" marks <number>/<year>, which always reads back as this act. */
  protected numbers(): string {
    const number = this.number;
    const year = this.year;
    if (number === undefined) return "";
    if (year === undefined || year === null) return String(number);

    const numberFirst = this.numberFirst();
    const pair = numberFirst ? [number, year] : [year, number];
    const klass = this.euTypeKey() === "identifier"
      ? "Identifier"
      : this.euTitle();
    if (numberFirstFor(klass, String(pair[0]), String(pair[1])) === numberFirst) {
      return pair.join("/");
    }
    return `No ${number}/${year}`;
  }
}

export class EuRegulation extends EuIdentifier {
  static polymorphicName = "pubid:eu:regulation";
  static override euType: EuType = {
    key: "regulation", title: "Regulation", celex: "R", eli: "reg",
  };
}

export class EuDirective extends EuIdentifier {
  static polymorphicName = "pubid:eu:directive";
  static override euType: EuType = {
    key: "directive", title: "Directive", celex: "L", eli: "dir",
  };
}

export class EuDecision extends EuIdentifier {
  static polymorphicName = "pubid:eu:decision";
  static override euType: EuType = {
    key: "decision", title: "Decision", celex: "D", eli: "dec",
  };
}

export type EuLeafClass = typeof EuRegulation | typeof EuDirective | typeof EuDecision;

/**
 * Which of two printed numbers is the year, when the input has no "No".
 * Only one plausible year: that one. Both: a first value from 2015 is
 * the year (every act prints <year>/<number> from 2015); otherwise a
 * regulation prints <number>/<year> and other acts <year>/<number>.
 * Neither plausible: undefined. The renderer calls this too, to know
 * when a plain print would read back as another act. `klass` is the
 * Ruby class-name fragment the gem's Builder.number_first_for compares
 * ("Regulation" — the leaf title — or "Identifier" on the base).
 */
export function numberFirstFor(
  klass: string,
  first: string,
  second: string,
): boolean | undefined {
  const firstYear = isPlausibleYear(first);
  const secondYear = isPlausibleYear(second);
  if (!firstYear && !secondYear) return undefined;
  if (firstYear !== secondYear) return !firstYear;
  if (Number(first) >= FIXED_ORDER_YEAR) return false;
  return klass === "Regulation";
}

/** The first Official Journal acts (ECSC) date from 1952. */
export function isPlausibleYear(value: string): boolean {
  return value.length === 4 && Number(value) >= 1952 && Number(value) <= 2099;
}

/** "0079" -> "79", "0" stays "0" (Ruby strip_zeros: leading zeros only,
 *  never the bare zero). */
export function stripLeadingZeros(number: string): string {
  return number.replace(/^0+(?=\d)/, "");
}

// The *_TYPE_MAP role: polymorphic dispatch for the three leaves plus
// the base (a hand-built hash without a leaf class serializes as
// pubid:eu:identifier — the gem's Identifier class itself).
registerType(EuIdentifier as unknown as IdentifierStatic);
registerType(EuRegulation as unknown as IdentifierStatic);
registerType(EuDirective as unknown as IdentifierStatic);
registerType(EuDecision as unknown as IdentifierStatic);
