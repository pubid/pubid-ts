import { Grammar, P, match, str } from "../../grammar/engine.js";
import type { Tree, TreeObject } from "../../grammar/engine.js";
import { ParseFailed, parseGrammar } from "../../grammar/engine.js";
import type { FlavorImplementation, Identifier } from "../../conformance/implementation.js";

/**
 * 1:1 port of lib/pubid/tgpp/ (3GPP). Form:
 *   [3GPP ]<TR|TS> <NN.NNN>[suffix][-part…][:<release>][/<version>]
 * The release excludes ":" and "/" so the URN can always encode it, and a
 * trailing version-shaped segment after ":" is rejected (mistyped "/"
 * separator), not misfiled as the release. The printed form carries no
 * publisher token; the URN keeps INTERIOR empty release segments
 * ("urn:3gpp:ts:29.215::2.0.0") but drops trailing ones.
 */

type TgppKind = "technical-report" | "technical-specification";

const KIND_PREFIXES: Record<TgppKind, string> = {
  "technical-report": "TR",
  "technical-specification": "TS",
};

const KIND_TYPES: Record<TgppKind, string> = {
  "technical-report": "pubid:3gpp:technical-report",
  "technical-specification": "pubid:3gpp:technical-specification",
};

function buildRules(): Record<string, P> {
  const rules: Record<string, P> = {};
  const rule = (name: string, build: () => P) => {
    rules[name] = build();
  };
  const digits = match("[0-9]").repeat(1, Infinity);
  const space = str(" ");
  const any = match("[\\s\\S]");

  rule("publisher_prefix", () => str("3GPP").then(space));
  rule("type", () => str("TR").or(str("TS")).as("type"));
  rule("number_core", () => digits.then(str("."), digits).as("number"));
  rule("suffix", () => match("[A-Za-z]").repeat(1, Infinity).as("suffix"));
  rule("part", () => str("-").then(digits.as("part")));
  rule("parts", () =>
    rules["part"]!.repeat(0, Infinity).as("parts"),
  );
  rule(
    "version_core",
    () => digits.then(str("."), digits, str("."), digits),
  );
  // A trailing segment shaped exactly like a version after ":" is a
  // mistyped "/" separator — reject it rather than misfiling the version
  // as the release.
  rule(
    "release",
    () =>
      rules["version_core"]!
        .then(any.absent())
        .absent()
        .then(match("[^/:]").repeat(1, Infinity).as("release")),
  );
  rule("version", () => rules["version_core"]!.as("version"));
  rule(
    "identifier",
    () =>
      rules["publisher_prefix"]!
        .maybe()
        .then(rules["type"]!, space, rules["number_core"]!)
        .then(rules["suffix"]!.maybe())
        .then(rules["parts"]!)
        .then(str(":").then(rules["release"]!).maybe())
        .then(str("/").then(rules["version"]!).maybe()),
  );
  rule("root", () => rules["identifier"]!);
  return rules;
}

export const tgppGrammar: Grammar = { rules: buildRules(), root: "root" };

export interface TgppIdentifier {
  kind: TgppKind;
  number: string;
  suffix?: string;
  parts: string[];
  release?: string;
  version?: string;
}

function isObj(v: Tree): v is TreeObject {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function extractParts(raw: Tree): string[] {
  if (Array.isArray(raw)) {
    return raw.map((p) => (isObj(p) ? String(p["part"]) : String(p)));
  }
  if (isObj(raw) && raw["part"] !== undefined) return [String(raw["part"])];
  return [];
}

export function buildTgppIdentifier(tree: Tree): TgppIdentifier {
  if (!isObj(tree) || tree["type"] === undefined || tree["number"] === undefined) {
    throw new ParseFailed("3GPP: unexpected parse tree", 0);
  }
  const id: TgppIdentifier = {
    kind: String(tree["type"]) === "TR" ? "technical-report" : "technical-specification",
    number: String(tree["number"]),
    parts: extractParts(tree["parts"]),
  };
  if (tree["suffix"] !== undefined && tree["suffix"] !== null) {
    id.suffix = String(tree["suffix"]);
  }
  if (tree["release"] !== undefined && tree["release"] !== null) {
    id.release = String(tree["release"]);
  }
  if (tree["version"] !== undefined && tree["version"] !== null) {
    id.version = String(tree["version"]);
  }
  return id;
}

export function code(id: TgppIdentifier): string {
  let result = id.number + (id.suffix ?? "");
  if (id.parts.length > 0) result += id.parts.map((p) => `-${p}`).join("");
  return result;
}

export function toHash(id: TgppIdentifier): Record<string, unknown> {
  const hash: Record<string, unknown> = { _type: KIND_TYPES[id.kind], number: id.number };
  if (id.suffix !== undefined) hash["suffix"] = id.suffix;
  if (id.parts.length > 0) hash["parts"] = id.parts;
  if (id.release !== undefined) hash["release"] = id.release;
  if (id.version !== undefined) hash["version"] = id.version;
  return hash;
}

export function fromHash(hash: Record<string, unknown>): TgppIdentifier {
  const type = String(hash["_type"]);
  const kind = type === "pubid:3gpp:technical-report" ? "technical-report" : "technical-specification";
  if (!(kind in KIND_TYPES) || `pubid:3gpp:${kind}` !== type) {
    throw new ParseFailed(`3GPP: unknown _type ${type}`, 0);
  }
  const id: TgppIdentifier = {
    kind,
    number: String(hash["number"]),
    parts: (hash["parts"] as string[] | undefined) ?? [],
  };
  if (hash["suffix"] !== undefined && hash["suffix"] !== null) {
    id.suffix = String(hash["suffix"]);
  }
  if (hash["release"] !== undefined && hash["release"] !== null) {
    id.release = String(hash["release"]);
  }
  if (hash["version"] !== undefined && hash["version"] !== null) {
    id.version = String(hash["version"]);
  }
  return id;
}

export function toHuman(id: TgppIdentifier): string {
  let result = `${KIND_PREFIXES[id.kind]} ${code(id)}`;
  if (id.release !== undefined && id.release !== "") result += `:${id.release}`;
  if (id.version !== undefined && id.version !== "") result += `/${id.version}`;
  return result;
}

// Trailing empty segments drop; an INTERIOR empty release segment stays
// ("urn:3gpp:ts:29.215::2.0.0").
export function toUrn(id: TgppIdentifier): string {
  const tail: (string | undefined)[] = [id.release, id.version];
  while (tail.length > 0 && (tail[tail.length - 1] === undefined || tail[tail.length - 1] === "")) {
    tail.pop();
  }
  return ["urn", "3gpp", KIND_PREFIXES[id.kind].toLowerCase(), code(id), ...tail.map((s) => s ?? "")].join(":");
}

class TgppIdentifierImpl implements Identifier {
  constructor(private readonly id: TgppIdentifier) {}
  toHash(): Record<string, unknown> {
    return toHash(this.id);
  }
  toHuman(): string {
    return toHuman(this.id);
  }
  toUrn(): string | undefined {
    return toUrn(this.id);
  }
  fromHash(hash: Record<string, unknown>): Identifier {
    return new TgppIdentifierImpl(fromHash(hash));
  }
}

export function tgppGrammarImplementation(): FlavorImplementation {
  return {
    parse(input: string): Identifier {
      return new TgppIdentifierImpl(buildTgppIdentifier(parseGrammar(tgppGrammar, input)));
    },
  };
}
