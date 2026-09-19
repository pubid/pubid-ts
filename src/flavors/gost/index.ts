import type { Tree, TreeObject } from "../../grammar/engine.js";
import { parseGrammar } from "../../grammar/engine.js";
import type { FlavorImplementation, Identifier } from "../../conformance/implementation.js";
import { grammarImplementation } from "../index.js";
import { gostGrammar } from "./grammar.js";
import { PREFIX_ROUTES } from "./prefix_routes.js";
import {
  ForeignReference,
  GostIdentifier,
  Harmonized,
  IdenticalAdoption,
  InterstateStandard,
  NationalStandard,
} from "./model.js";

/**
 * Port of lib/pubid/gost/builder.rb — prefix normalization, number/year
 * split, and the identical-adoption/harmonized wrappers.
 */

type GostCtor = new (attrs?: Record<string, unknown>) => GostIdentifier;

const COPUBLISHER_MAP: Record<string, string> = {
  "ИСО": "ISO", "МЭК": "IEC", "ЕН": "EN",
  "ИСО/МЭК": "ISO/IEC", "МЭК/ИСО": "IEC/ISO",
  "ИСО/ТУ": "ISO/TS", "ИСО/ТО": "ISO/TR",
  "МЭК/ТУ": "IEC/TS", "МЭК/ТО": "IEC/TR",
  "ИСО/МЭК/ТУ": "ISO/IEC/TS",
};

const SUBTYPE_MAP: Record<string, string> = {
  "МФС": "ISP", "ТУ": "TS", "ТО": "TR",
};

const NUMBER_YEAR_SPLIT = /^(.+?)\s*[-—–]\s*(\d{2}|\d{4})$/;

// The gem's try_each_flavor iterates Registry.flavor_names.sort; this
// mirrors that order over the TS grammar registry. The unported flavors
// (adobe, amca, api, ashrae, asme, bsi, csa, sae, cen) are skipped,
// except bsi, whose slot substitutes [iso, iec]: bsi's grammar parses
// bare ISO/IEC/IEEE references (adopted inside BS documents) and returns
// the owning flavor's identifier — that is what routes the joint
// "ISO/IEC …" adoptions to the ISO flavor ahead of IEC. When bsi is
// ported, replace the substitution with the real flavor.
const FOREIGN_FALLBACK_ORDER = [
  "tgpp", "ansi", "astm", "bipm",
  "iso", "iec",
  "calconnect", "ccsds", "cen_cenelec", "cie", "doi", "easc", "ecma",
  "etsi", "gb", "iala", "iana", "idf", "ieee", "ietf", "iho", "isbn",
  "itu", "jcgm", "jis", "nist", "oasis", "ogc", "oiml", "omg",
  "plateau", "un", "w3c", "xsf",
];

const str = (v: unknown): string | undefined => {
  if (v === undefined || v === null) return undefined;
  const s = Array.isArray(v) ? v.map(String).join("") : String(v);
  return s.length > 0 ? s : undefined;
};

function flatten(tree: Tree): TreeObject {
  return Array.isArray(tree) ? (Object.assign({}, ...tree) as TreeObject) : (tree as TreeObject);
}

function buildIdentifier(tree: Tree): Identifier {
  return buildFrom(flatten(tree)) as unknown as Identifier;
}

function buildFrom(d: TreeObject): GostIdentifier {
  const russian = d["scope_r"] !== undefined;
  const [copublisher, subtype] = splitPrefix(str(d["prefix_text"]));
  const [number, year] = splitNumberYear(str(d["raw"]));

  const klass = (russian ? NationalStandard : InterstateStandard) as unknown as GostCtor;
  const base = new klass({
    ...(copublisher !== undefined ? { copublisher } : {}),
    ...(subtype !== undefined ? { subtype } : {}),
    ...(number !== undefined ? { number } : {}),
    ...(year !== undefined ? { year } : {}),
  });
  return withForeignAdoption(base, d);
}

function withForeignAdoption(base: GostIdentifier, d: TreeObject): GostIdentifier {
  return wrapHarmonized(wrapIdenticalAdoption(base, d), d);
}

function wrapIdenticalAdoption(base: GostIdentifier, d: TreeObject): GostIdentifier {
  const adoptedRaw = str(d["adopted_raw"]);
  if (adoptedRaw === undefined) return base;

  const adopted = parseForeign(adoptedRaw);
  const klass = IdenticalAdoption as unknown as GostCtor;
  return new klass({ base, adopted });
}

function wrapHarmonized(base: GostIdentifier, d: TreeObject): GostIdentifier {
  const referenceRaw = str(d["adopted_reference_raw"]);
  if (referenceRaw === undefined) return base;

  const adopted = referenceRaw
    .split(",")
    .map((s) => s.trim())
    .map(normalizeForeign)
    .map(adoptIdentifier);
  const klass = Harmonized as unknown as GostCtor;
  return new klass({ base, adoptedIdentifiers: adopted });
}

function adoptIdentifier(raw: string): GostIdentifier {
  return parseForeign(raw) ?? new (ForeignReference as unknown as GostCtor)({ raw });
}

function splitPrefix(text: string | undefined): [string | undefined, string | undefined] {
  if (text === undefined) return [undefined, undefined];
  const tokens = text.trim().split(/\s+/);
  const copublisher = normalizeCopublisher(tokens[0]);
  const subtype = tokens.length > 1 ? normalizeSubtype(tokens.slice(1).join(" ")) : undefined;
  return [copublisher, subtype];
}

function normalizeCopublisher(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  return COPUBLISHER_MAP[raw] ?? raw.toUpperCase();
}

function normalizeSubtype(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  return SUBTYPE_MAP[raw] ?? raw;
}

// Longest keys first so "ИСО/МЭК" wins over "ИСО".
function normalizeForeign(raw: string): string {
  for (const cyr of Object.keys(COPUBLISHER_MAP).sort((a, b) => b.length - a.length)) {
    if (raw.startsWith(cyr + " ") || raw.startsWith(cyr + "/")) {
      return COPUBLISHER_MAP[cyr] + raw.slice(cyr.length);
    }
  }
  return raw;
}

function splitNumberYear(raw: string | undefined): [string | undefined, string | undefined] {
  if (raw === undefined) return [undefined, undefined];
  const m = NUMBER_YEAR_SPLIT.exec(raw);
  if (m === null) return [raw, undefined];
  return [m[1], m[2]];
}

// The single flavor owning the longest matching prefix; undefined when
// no prefix matches or the prefix is jointly owned (joint forms go
// through the fallback loop).
function prefixOwner(raw: string): string | undefined {
  let match: string | undefined;
  for (const prefix of Object.keys(PREFIX_ROUTES)) {
    if ((raw.startsWith(`${prefix} `) || raw === prefix) &&
        (match === undefined || prefix.length > match.length)) {
      match = prefix;
    }
  }
  if (match === undefined) return undefined;
  const owners = PREFIX_ROUTES[match] ?? [];
  return owners.length === 1 ? owners[0] : undefined;
}

function tryParse(flavor: string, raw: string): GostIdentifier | undefined {
  const impl = grammarImplementation(flavor);
  if (impl === undefined) return undefined;
  try {
    return impl.parse(raw) as unknown as GostIdentifier;
  } catch {
    return undefined;
  }
}

function parseForeign(raw: string): GostIdentifier | undefined {
  const owner = prefixOwner(raw);
  if (owner !== undefined) {
    const parsed = tryParse(owner, raw);
    if (parsed !== undefined) return parsed;
  }
  for (const flavor of FOREIGN_FALLBACK_ORDER) {
    const parsed = tryParse(flavor, raw);
    if (parsed !== undefined) return parsed;
  }
  return undefined;
}

export function gostGrammarImplementation(): FlavorImplementation {
  return {
    parse(input: string): Identifier {
      const tree = parseGrammar(gostGrammar, input.trim());
      return buildIdentifier(tree);
    },
  };
}
