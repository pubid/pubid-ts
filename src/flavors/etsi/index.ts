import { Grammar, P, match, str } from "../../grammar/engine.js";
import type { Tree, TreeObject } from "../../grammar/engine.js";
import { ParseFailed, parseGrammar } from "../../grammar/engine.js";
import type { FlavorImplementation, Identifier } from "../../conformance/implementation.js";
import { BaseIdentifier, registerType } from "../../model/identifier.js";
import type { IdentifierStatic } from "../../model/identifier.js";
import { extendAttributes, keyValue } from "../../model/attribute.js";
import { BaseUrnGenerator } from "../../model/urn-generator.js";
import { Component, PubidDate } from "../../model/component.js";

/**
 * Port of lib/pubid/etsi/ on the unified model — the largest corpus
 * (24,724 rows). "ETSI TYPE CODE[-parts][/A…/C…] [V…|ed.N] (YYYY-MM)".
 * Compact serialization: number/parts/minor flat, Version flattens to a
 * scalar + is_edition flag (omitted when false), Date to year/month.
 * The publisher constant is never serialized. Supplements carry only
 * their ordinal and the nested base; their URN is the BASE's URN —
 * Ruby's generator string-matches "SupplementIdentifier" on the class
 * NAME, which "Amendment" doesn't contain, so supplements fall through
 * to the base branch (corpus-recorded behavior, mirrored exactly).
 */

const TYPES = ["I-ETS", "TCRTR", "GTS", "ETR", "ETS", "TBR", "NET", "EN", "ES", "EG", "TS", "GR", "GS", "SR", "TR"] as const;

function buildRules(): Record<string, P> {
  const rules: Record<string, P> = {};
  const rule = (name: string, build: () => P) => {
    rules[name] = build();
  };
  const space = str(" ");
  const digits = match("[0-9]").repeat(1, Infinity);
  const alnum = match("[A-Za-z0-9]");
  const alnums = alnum.repeat(1, Infinity);
  const dot = str(".");

  rule("etsi_prefix", () => str("ETSI").then(space));
  rule("type", () =>
    TYPES.reduce<P>((acc, t) => acc.or(str(t)), str(TYPES[0])).as("type"),
  );
  // parslet capture() converted to named captures; the builder composes
  // the number string from whichever keys matched.
  rule("gsm_with_space_number", () =>
    str("GSM").as("gsm_prefix").then(space, digits.as("main"), dot, digits.as("sub")),
  );
  rule("dotted_number", () => digits.as("main").then(dot, digits.as("sub")));
  rule("complex_number", () =>
    alnums.as("prefix1")
      .then(str("-").then(alnums.as("prefix2")).maybe())
      .then(space, digits.as("num")),
  );
  rule("simple_number", () => digits.as("num"));
  rule("number", () =>
    rules["gsm_with_space_number"]!
      .or(rules["dotted_number"]!)
      .or(rules["complex_number"]!)
      .or(rules["simple_number"]!)
      .as("number"),
  );
  rule("minor", () => space.then(digits.as("minor")));
  rule("part", () => str("-").then(alnums.as("part")));
  rule("parts", () => rules["part"]!.repeat(0, Infinity).as("parts"));
  rule("version", () => str("V").then(match("[0-9.]").repeat(1, Infinity).as("version")));
  rule("edition", () => str("ed.").then(digits.as("edition")));
  rule("version_or_edition", () => rules["version"]!.or(rules["edition"]!));
  rule("date_part", () =>
    str("(")
      .then(
        match("[0-9]").repeat(4, 4).as("year"),
        str("-"),
        match("[0-9]").repeat(2, 2).as("month"),
        str(")"),
      ),
  );
  rule("amendment", () => str("/A").then(digits.as("number")));
  rule("corrigendum", () => str("/C").then(digits.as("number")));
  rule("supplements", () =>
    rules["amendment"]!.as("amendment").or(rules["corrigendum"]!.as("corrigendum")).repeat(1, Infinity).as("supplements"),
  );
  rule("identifier", () =>
    rules["etsi_prefix"]!
      .then(rules["type"]!, space, rules["number"]!)
      .then(rules["minor"]!.maybe())
      .then(rules["parts"]!)
      .then(rules["supplements"]!.maybe())
      .then(space.then(rules["version_or_edition"]!).maybe())
      .then(space.then(rules["date_part"]!).maybe()),
  );
  rule("root", () => rules["identifier"]!);
  return rules;
}

export const etsiGrammar: Grammar = { rules: buildRules(), root: "root" };

/** ETSI Version component: "V1.2.3" or "ed.1". */
export class EtsiVersion extends Component {
  readonly version: string;
  readonly is_edition: boolean;

  constructor(attrs: Record<string, unknown>) {
    super();
    this.version = attrs["version"] as string;
    this.is_edition = (attrs["is_edition"] as boolean | undefined) ?? false;
  }

  render(): string {
    return this.is_edition ? `ed.${this.version}` : `V${this.version}`;
  }

  toWire(): Record<string, unknown> {
    return { version: this.version, is_edition: this.is_edition };
  }

  protected fieldIsDefaulted(name: string, value: unknown): boolean {
    return name === "is_edition" && value === false;
  }
}

abstract class EtsiIdentifier extends BaseIdentifier {
  declare readonly type: string | undefined;
  declare readonly number: string | undefined;
  declare readonly minor: string | undefined;
  declare readonly parts: string[] | undefined;
  declare readonly version: EtsiVersion | undefined;
  declare readonly date: PubidDate | undefined;
  declare readonly base: EtsiIdentifier | undefined;

  /** Components::Code#to_s: number, minor after a space, parts dashed. */
  code(): string | undefined {
    if (this.number === undefined) return undefined;
    let result = this.number;
    if (this.minor !== undefined) result += ` ${this.minor}`;
    if (this.parts !== undefined) result += this.parts.map((p) => `-${p}`).join("");
    return result;
  }

  supplementNotation(): string {
    return "";
  }

  actualBase(): EtsiIdentifier {
    let current = this.base ?? this;
    while (current.base !== undefined) current = current.base;
    return current;
  }
}

// Version and Date flatten through converter mappings (Ruby's with: hooks).
const ETSI_MAPPINGS = keyValue(
  { wire: "type", to: "type" },
  { wire: "number", to: "number" },
  { wire: "parts", to: "parts" },
  { wire: "minor", to: "minor" },
  {
    wire: "version",
    to: "version",
    toWire: (m) => (m["version"] as EtsiVersion | undefined)?.version,
    fromWire: (h) =>
      h["version"] === undefined || h["version"] === null
        ? undefined
        : new EtsiVersion({ version: String(h["version"]), is_edition: h["is_edition"] === true }),
  },
  {
    wire: "is_edition",
    to: "version",
    toWire: (m) => ((m["version"] as EtsiVersion | undefined)?.is_edition ? true : undefined),
    fromWire: () => undefined,
  },
  {
    wire: "year",
    to: "date",
    toWire: (m) => (m["date"] as PubidDate | undefined)?.year,
    fromWire: (h) =>
      h["year"] === undefined || h["year"] === null
        ? undefined
        : new PubidDate({ year: String(h["year"]), month: h["month"] as string | undefined }),
  },
  { wire: "month", to: "date", toWire: (m) => (m["date"] as PubidDate | undefined)?.month, fromWire: () => undefined },
);

function etsiClass(kind: "etsi-standard" | "amendment" | "corrigendum"): IdentifierStatic {
  const isStandard = kind === "etsi-standard";
  class EtsiKindIdentifier extends EtsiIdentifier {
    static polymorphicName = `pubid:etsi:${kind}`;
    static attributes = isStandard
      ? extendAttributes(BaseIdentifier, {
          type: { type: "string" },
          number: { type: "string" },
          minor: { type: "string" },
          parts: { type: "string", collection: true, initializeEmpty: true },
          version: { type: EtsiVersion },
        })
      : extendAttributes(BaseIdentifier, {
          base: { type: EtsiIdentifier as unknown as IdentifierStatic },
          number: { type: "integer" },
        });
    static mappings = isStandard
      ? ETSI_MAPPINGS
      : keyValue(
          { wire: "number", to: "number" },
          { wire: "base", to: "base" },
        );

    render(): string {
      if (isStandard) {
        let result = `ETSI ${this.type} ${this.code()}`;
        if (this.version !== undefined) result += ` ${this.version.render()}`;
        const d = this.date?.render();
        if (d !== undefined && d !== "") result += ` (${d})`;
        return result;
      }
      // render_supplement: the innermost base code plus the chain of
      // notations ("/A1/C2"), innermost first.
      const notations: string[] = [];
      const collect = (id: EtsiIdentifier): void => {
        if (id.base !== undefined) {
          notations.unshift(`/${id.supplementNotation()}`);
          collect(id.base);
        }
      };
      collect(this as unknown as EtsiIdentifier);
      const actualBase = this.actualBase();
      let result = `ETSI ${actualBase.type} ${actualBase.code()}${notations.join("")}`;
      if (actualBase.version !== undefined) result += ` ${actualBase.version.render()}`;
      const d = actualBase.date?.render();
      if (d !== undefined && d !== "") result += ` (${d})`;
      return result;
    }

    supplementNotation(): string {
      const prefix = kind === "corrigendum" ? "C" : "A";
      return `${prefix}${(this as unknown as { number?: number }).number ?? ""}`;
    }

  }
  registerType(EtsiKindIdentifier as unknown as IdentifierStatic);
  return EtsiKindIdentifier as unknown as IdentifierStatic;
}

const KIND_CLASSES = {
  "etsi-standard": etsiClass("etsi-standard"),
  amendment: etsiClass("amendment"),
  corrigendum: etsiClass("corrigendum"),
} as const;

class EtsiUrnGenerator extends BaseUrnGenerator<EtsiIdentifier> {
  generate(): string {
    // Ruby's generator string-matches "SupplementIdentifier" on the
    // class NAME; "Amendment"/"Corrigendum" don't contain it, so every
    // supplement produces the BASE urn — mirrored exactly. The base's
    // type/code/version/date delegate transitively down a supplement
    // chain, i.e. they are the innermost standard's.
    const id = (this.identifier as unknown as EtsiIdentifier).actualBase();
    const parts = ["urn", "etsi"];
    if (id.type !== undefined) parts.push(id.type.toLowerCase());
    const code = id.code();
    if (code !== undefined) parts.push(code);
    if (id.version !== undefined) parts.push(id.version.render().toLowerCase());
    const d = id.date?.render();
    if (d !== undefined && d !== "") parts.push(d);
    return parts.join(":");
  }
}
for (const klass of Object.values(KIND_CLASSES)) {
  (klass as unknown as Record<string, unknown>).urnGenerator = EtsiUrnGenerator;
}

function isObj(v: Tree): v is TreeObject {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function composeNumber(numberData: Tree): string {
  if (isObj(numberData)) {
    const main = numberData["main"];
    const sub = numberData["sub"];
    if (numberData["gsm_prefix"] !== undefined) return `GSM ${String(main)}.${String(sub)}`;
    if (main !== undefined && sub !== undefined) return `${String(main)}.${String(sub)}`;
    if (numberData["prefix1"] !== undefined) {
      let prefix = String(numberData["prefix1"]);
      if (numberData["prefix2"] !== undefined) prefix += `-${String(numberData["prefix2"])}`;
      return `${prefix} ${String(numberData["num"])}`;
    }
    return String(numberData["num"]);
  }
  return String(numberData);
}

function extractParts(partsData: Tree): string[] {
  if (Array.isArray(partsData)) {
    return partsData.map((p) => (isObj(p) ? String(p["part"]) : String(p)));
  }
  if (isObj(partsData) && partsData["part"] !== undefined) return [String(partsData["part"])];
  return [];
}

class EtsiBuilder {
  build(data: Tree | TreeObject): BaseIdentifier {
    const tree = (Array.isArray(data) ? Object.assign({}, ...data) : data) as TreeObject;
    if (tree["supplements"] !== undefined) return this.buildWithSupplements(tree);
    return this.buildStandard(tree);
  }

  private buildStandard(data: TreeObject): BaseIdentifier {
    const attrs: Record<string, unknown> = {
      type: String(data["type"]),
      number: composeNumber(data["number"]),
      parts: extractParts(data["parts"]),
    };
    if (data["minor"] !== undefined && data["minor"] !== null) {
      attrs["minor"] = String(data["minor"]);
    }
    if (data["version"] !== undefined && data["version"] !== null) {
      attrs["version"] = new EtsiVersion({ version: String(data["version"]), is_edition: false });
    } else if (data["edition"] !== undefined && data["edition"] !== null) {
      attrs["version"] = new EtsiVersion({ version: String(data["edition"]), is_edition: true });
    }
    if (data["year"] !== undefined && data["year"] !== null) {
      attrs["date"] = new PubidDate({ year: String(data["year"]), month: data["month"] === undefined || data["month"] === null ? undefined : String(data["month"]) });
    }
    return new (KIND_CLASSES["etsi-standard"] as unknown as new (a?: Record<string, unknown>) => BaseIdentifier)(attrs);
  }

  private buildWithSupplements(data: TreeObject): BaseIdentifier {
    const baseData = { ...data };
    delete baseData["supplements"];
    let base = this.buildStandard(baseData);
    const supplements = Array.isArray(data["supplements"]) ? data["supplements"] : [data["supplements"]];
    for (const supp of supplements) {
      if (!isObj(supp)) continue;
      if (supp["amendment"] !== undefined) {
        const inner = isObj(supp["amendment"]) ? (supp["amendment"] as TreeObject) : undefined;
        base = new (KIND_CLASSES["amendment"] as unknown as new (a?: Record<string, unknown>) => BaseIdentifier)({
          base,
          number: Number(inner === undefined ? supp["amendment"] : inner["number"]),
        });
      } else if (supp["corrigendum"] !== undefined) {
        const inner = isObj(supp["corrigendum"]) ? (supp["corrigendum"] as TreeObject) : undefined;
        base = new (KIND_CLASSES["corrigendum"] as unknown as new (a?: Record<string, unknown>) => BaseIdentifier)({
          base,
          number: Number(inner === undefined ? supp["corrigendum"] : inner["number"]),
        });
      }
    }
    return base;
  }
}

export function etsiGrammarImplementation(): FlavorImplementation {
  const builder = new EtsiBuilder();
  return {
    parse(input: string): Identifier {
      const tree = parseGrammar(etsiGrammar, input);
      if (typeof tree !== "object" || tree === null) {
        throw new ParseFailed("ETSI: unexpected parse tree", 0);
      }
      return builder.build(tree) as unknown as Identifier;
    },
  };
}
