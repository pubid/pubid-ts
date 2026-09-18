import { Grammar, P, match, str } from "../../grammar/engine.js";
import { ParseFailed, parseGrammar } from "../../grammar/engine.js";
import type { FlavorImplementation, Identifier } from "../../conformance/implementation.js";
import { BaseIdentifier, registerType } from "../../model/identifier.js";
import type { IdentifierStatic } from "../../model/identifier.js";
import { extendAttributes, keyValue } from "../../model/attribute.js";
import { BaseUrnGenerator } from "../../model/urn-generator.js";

/**
 * 1:1 port of lib/pubid/ietf/ on the unified model — 2,526 corpus rows.
 * Three flat families keyed by leading token: RFC, the BCP/STD/FYI
 * sub-series (series derived from the class, never stored — `_type`
 * already carries it), and Internet-Drafts (slug including "draft-" in
 * `number`, optional trailing two-digit `version`). URNs:
 * urn:ietf:rfc:n / urn:ietf:{bcp|std|fyi}:n / urn:ietf:id:draft-slug[:v].
 */

function buildRules(): Record<string, P> {
  const rules: Record<string, P> = {};
  const rule = (name: string, build: () => P) => {
    rules[name] = build();
  };
  const digits = match("[0-9]").repeat(1, Infinity);

  // "RFC 2119" and the zero-padded space-less spelling rfc-index.xml
  // emits ("RFC0001") — the Builder strips the pad.
  rule("rfc", () => str("RFC").then(str(" ").maybe(), digits.as("number")));

  // "BCP 3" / "STD 66" / "FYI 1", plus the padded "<is-also>STD0066"
  // form relaton builds cross-references from, unnormalized.
  rule("subseries", () =>
    str("BCP")
      .or(str("STD"), str("FYI"))
      .as("series")
      .then(str(" ").maybe(), digits.as("number")),
  );

  // Draft slug characters plus the two historical shapes the corpus
  // carries: a dot inside a topic token and uppercase protocol names.
  rule("draft_rest", () =>
    match("[a-zA-Z0-9+_.\\-]").repeat(1, Infinity).as("draft_rest"),
  );

  rule("draft", () => str("draft-").then(rules["draft_rest"]!));

  rule("identifier", () =>
    rules["rfc"]!.or(rules["subseries"]!, rules["draft"]!),
  );
  rule("root", () => rules["identifier"]!);
  return rules;
}

export const ietfGrammar: Grammar = { rules: buildRules(), root: "root" };

abstract class IetfIdentifier extends BaseIdentifier {
  declare readonly number: string | undefined;

  /** Fail loudly on a nil number rather than keying the index under "". */
  requireNumber(): string {
    if (this.number === undefined || this.number === "") {
      throw new ParseFailed(`Cannot render ${this.constructor.polymorphicName} with an empty number`, 0);
    }
    return this.number;
  }
}

class IetfUrnGenerator extends BaseUrnGenerator<IetfIdentifier> {
  generate(): string {
    const id = this.identifier as IetfIdentifier;
    if (id instanceof IetfRfc) return `urn:ietf:rfc:${id.requireNumber()}`;
    if (id instanceof IetfInternetDraft) {
      const base = `urn:ietf:id:${id.requireNumber()}`;
      return id.version === undefined ? base : `${base}:${id.version}`;
    }
    if (id instanceof IetfSubseriesBase) {
      return `urn:ietf:${id.seriesToken().toLowerCase()}:${id.requireNumber()}`;
    }
    throw new ParseFailed("IETF: not a concrete identifier", 0);
  }
}

abstract class IetfSubseriesBase extends IetfIdentifier {
  static attributes = extendAttributes(BaseIdentifier, {
    number: { type: "string" },
  });
  static mappings = keyValue({ wire: "number", to: "number" });
  static urnGenerator = IetfUrnGenerator;

  abstract seriesToken(): string;

  render(): string {
    return `${this.seriesToken()} ${this.requireNumber()}`;
  }
}

export class IetfRfc extends IetfIdentifier {
  static polymorphicName = "pubid:ietf:rfc";
  static attributes = extendAttributes(BaseIdentifier, {
    number: { type: "string" },
  });
  static mappings = keyValue({ wire: "number", to: "number" });
  static urnGenerator = IetfUrnGenerator;

  render(): string {
    return `RFC ${this.requireNumber()}`;
  }
}
registerType(IetfRfc as unknown as IdentifierStatic);

function subseriesClass(kind: "bcp" | "std" | "fyi", token: string): new (a?: Record<string, unknown>) => IetfSubseriesBase {
  class IetfSubseriesKind extends IetfSubseriesBase {
    static polymorphicName = `pubid:ietf:${kind}`;
    seriesToken(): string {
      return token;
    }
  }
  registerType(IetfSubseriesKind as unknown as IdentifierStatic);
  return IetfSubseriesKind as unknown as new (a?: Record<string, unknown>) => IetfSubseriesBase;
}

const SUBSERIES_CLASSES = {
  bcp: subseriesClass("bcp", "BCP"),
  std: subseriesClass("std", "STD"),
  fyi: subseriesClass("fyi", "FYI"),
};

export class IetfInternetDraft extends IetfIdentifier {
  static polymorphicName = "pubid:ietf:internet-draft";
  static attributes = extendAttributes(BaseIdentifier, {
    number: { type: "string" },
    version: { type: "string" },
  });
  static mappings = keyValue(
    { wire: "number", to: "number" },
    { wire: "version", to: "version" },
  );
  static urnGenerator = IetfUrnGenerator;

  declare readonly version: string | undefined;

  render(): string {
    const number = this.requireNumber();
    return this.version === undefined ? number : `${number}-${this.version}`;
  }
}
registerType(IetfInternetDraft as unknown as IdentifierStatic);

const SUBSERIES_TOKENS: Record<string, keyof typeof SUBSERIES_CLASSES> = {
  BCP: "bcp",
  STD: "std",
  FYI: "fyi",
};

/** Strip the rfc-index.xml zero-pad ("STD0066" → "66"; "000" stays "0"). */
function unpad(number: string): string {
  return number.replace(/^0+(?=\d)/, "");
}

/**
 * A draft version is a trailing "-NN" of exactly two digits at the very
 * end: a three-digit topic tail ("…-256") keeps its char-before-last-two
 * a digit, not "-", so it stays in the slug.
 */
function splitDraftVersion(full: string): [string, string | undefined] {
  if (full.length > 3 && full.at(-3) === "-" && /^\d\d$/.test(full.slice(-2))) {
    return [full.slice(0, -3), full.slice(-2)];
  }
  return [full, undefined];
}

export function ietfGrammarImplementation(): FlavorImplementation {
  return {
    parse(input: string): Identifier {
      const tree = parseGrammar(ietfGrammar, input) as Record<string, unknown>;
      if (typeof tree !== "object" || tree === null) {
        throw new ParseFailed("IETF: unexpected parse tree", 0);
      }
      if (tree["draft_rest"] !== undefined) {
        const [slug, version] = splitDraftVersion(`draft-${String(tree["draft_rest"])}`);
        return new IetfInternetDraft({ number: slug, ...(version !== undefined ? { version } : {}) }) as unknown as Identifier;
      }
      if (tree["series"] !== undefined) {
        const klass = SUBSERIES_CLASSES[SUBSERIES_TOKENS[String(tree["series"])]!]!;
        return new klass({ number: unpad(String(tree["number"])) }) as unknown as Identifier;
      }
      return new IetfRfc({ number: unpad(String(tree["number"])) }) as unknown as Identifier;
    },
  };
}
