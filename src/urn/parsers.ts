import type { Identifier } from "../conformance/implementation.js";
import { splitParts, withYear, type UrnParserDef } from "./types.js";

// Each parser mirrors lib/pubid/<flavor>/urn_parser.rb#parse_urn exactly —
// including its lossiness (dropped segments stay dropped) and its error
// cases. The parity fixture (test/fixtures/urn-parity.json) pins the
// reference behavior for ~93k corpus URNs.

// --- the IHO URN decode (lib/pubid/iho/urn_parser.rb) -------------------
//
// Both namespaces decode onto the canonical shape through the same
// marker machinery: the segments build an attribute map (the positional
// ed-/year- attachment included), and the map renders the canonical
// human text for the text parse — the draft-era part faces rebind
// through the builder and the spelling face drops, so a decoded
// identifier renders the primary colon designator.

const IHO_MRN_TYPE_LETTERS: Record<string, string> = { spec: "S", per: "P", reg: "M" };
// The publication name: the lowercase series letter + number, the
// S-158 member hyphen-joined (s158-102).
const IHO_MRN_NAME_RE = /^([spmbc])(\d+)(?:-(\d+))?$/;
const IHO_DOTTED = /^\d+\.\d+\.\d+$/;
const IHO_SUBNUMBER = /^\d+$/;
// The docnumber's own charset: digits with : / - suffix runs.
const IHO_NUMBER = /^\d+(?:[:/-]\d+)*$/;
// Marker => attribute, with the value pattern each marker's slot
// accepts (the grammar's own production rules; values case-preserved).
const IHO_MARKERS: Record<string, { key: string; pattern: RegExp }> = {
  ed: { key: "ed", pattern: /^\d+\.\d+\.\d+$/ },
  sup: { key: "supplement", pattern: /^\d+$/ },
  part: { key: "part", pattern: /^(?:\d+[a-zA-Z]*|[A-Z]|[SPMBC]-\d+)$/ },
  spec: { key: "spec", pattern: /^[1-6]\d\d$/ },
  specsub: { key: "spec_sub", pattern: /^\d+$/ },
  specvar: { key: "spec_variant", pattern: /^[A-Z]+$/ },
  annex: { key: "annex", pattern: /^[A-Z]$/ },
  appendix: { key: "appendix", pattern: /^(?:[A-Z](?:-\d+)?|\d+)$/ },
  vol: { key: "volume", pattern: /^\d+$/ },
  issue: { key: "issue", pattern: /^\d+$/ },
  year: { key: "year", pattern: /^(?:19|20)\d{2}$/ },
};
const IHO_MARKER_RE = new RegExp(`^(${Object.keys(IHO_MARKERS).join("|")})-(.+)$`);
// Legacy dotted keys (deprecated; decodable, never emitted). "y." is
// the pre-positional year tag — a year IS a volume, so its value
// decodes into the volume.
const IHO_LEGACY_KEYS: Record<string, string> = {
  part: "part",
  annex: "annex",
  suppl: "supplement",
  ap: "appendix",
  appendix: "appendix",
  vol: "volume",
  issue: "issue",
  y: "volume",
};

/** The segments build the attribute map: marker segments validated
 *  against their own value pattern, ed-/year- positional (the edition
 *  attaches to the component it follows, the year to that component's
 *  edition owner), specsub-/specvar- only after their parent, the
 *  appendix carrying its subnumber hyphen-joined or as the bare atom
 *  directly after it. Unknown, reordered or junk segments reject. */
function ihoConsumeSegments(attrs: Record<string, string>, segments: string[], body: string): void {
  let component: string | undefined;
  let editionOwner: string | undefined;
  const fail = (message: string, segment: string): never => {
    throw new Error(`${message} ${JSON.stringify(segment)} in ${JSON.stringify(body)}`);
  };
  const store = (key: string, value: string): void => {
    if (attrs[key] !== undefined) fail("Duplicate", `${key}: ${value}`);
    attrs[key] = value;
  };
  const isSpecNode = (node: string | undefined): boolean =>
    node === "spec" || node === "spec_sub" || node === "spec_variant";
  for (let idx = 0; idx < segments.length; idx += 1) {
    const segment = segments[idx]!;
    const marker = IHO_MARKER_RE.exec(segment);
    if (marker !== null) {
      const tag = marker[1]!;
      const value = marker[2]!;
      const entry = IHO_MARKERS[tag]!;
      if (!entry.pattern.test(value)) fail(`Invalid ${tag} value`, JSON.stringify(value));
      const key = entry.key;
      if ((key === "spec_sub" || key === "spec_variant") &&
          component !== "spec" && component !== "spec_sub") {
        fail(`${key}- is only allowed after spec- in`, segment);
      }
      if (key === "ed" || key === "year") {
        // Positional: the edition attaches to the component it follows
        // (the base when none precedes), the year to that component's
        // edition owner. An S-4 spec carries neither — it rides its
        // publication's edition.
        if (isSpecNode(component)) {
          fail("an S-4 spec rides its publication's edition:", segment);
        }
        if (key === "ed") {
          store(component === undefined ? "edition" : `${component}_edition`, value);
          editionOwner = component;
        } else {
          store(editionOwner !== undefined ? `${editionOwner}_year` : "year", value);
          editionOwner = undefined;
        }
        continue;
      }
      if (key === "appendix") {
        // The hyphen-joined compound value ("D-2", the MRN emission)
        // splits into the appendix and its subnumber; the legacy
        // emission carries the subnumber as the bare atom below.
        const compound = /^([A-Z])-(\d+)$/.exec(value);
        if (compound !== null) {
          store("appendix", compound[1]!);
          store("appendix_subnumber", compound[2]!);
        } else {
          store("appendix", value);
        }
        component = "appendix";
        editionOwner = undefined;
        const next = segments[idx + 1];
        if (next !== undefined && IHO_SUBNUMBER.test(next)) {
          store("appendix_subnumber", next);
          idx += 1;
        }
        continue;
      }
      store(key, value);
      component = key;
      editionOwner = undefined;
      continue;
    }
    const legacy = /^([a-z]+)\.(.*)$/.exec(segment);
    if (legacy !== null) {
      const key = IHO_LEGACY_KEYS[legacy[1]!];
      if (key === undefined) fail("Unexpected segment", segment);
      // The legacy appendix value stored the subnumber in one string
      // ("appendix.D-2"); it decodes into the two components.
      const sub = key === "appendix" ? /^([A-Z])-(\d+)$/.exec(legacy[2]!) : null;
      if (sub !== null) {
        store("appendix", sub[1]!);
        store("appendix_subnumber", sub[2]!);
      } else {
        store(key!, legacy[2]!);
      }
      continue;
    }
    if (IHO_DOTTED.test(segment)) {
      // A bare a.b.c segment is the legacy edition encoding.
      store("edition", segment);
      continue;
    }
    fail("Unexpected segment", segment);
  }
}

/** The canonical human text of a decoded attribute map (the render's
 *  own FACES order: the colon designator on the code, the edition
 *  before the part, the citation replacing the Part face). */
function ihoCanonicalText(typeLetter: string, attrs: Record<string, string>): string {
  let text = `IHO ${typeLetter}-${attrs["number"] ?? ""}`;
  if (attrs["checks_for"] !== undefined) text += `:${attrs["checks_for"]}`;
  if (attrs["edition"] !== undefined) text += ` ${attrs["edition"]}`;
  if (attrs["supplement"] !== undefined) {
    text += ` Sup ${attrs["supplement"]}`;
    if (attrs["supplement_edition"] !== undefined) text += ` ${attrs["supplement_edition"]}`;
    if (attrs["supplement_year"] !== undefined) text += ` (${attrs["supplement_year"]})`;
  }
  if (attrs["spec"] !== undefined) {
    // "B-401", "B-122.1", "B-521(I)" — the citation face replaces the
    // Part face.
    text += ` ${attrs["part"]}-${attrs["spec"]}`;
    if (attrs["spec_sub"] !== undefined) text += `.${attrs["spec_sub"]}`;
    if (attrs["spec_variant"] !== undefined) text += `(${attrs["spec_variant"]})`;
  } else if (attrs["part"] !== undefined) {
    text += ` Part ${attrs["part"]}`;
    if (attrs["part_edition"] !== undefined) text += ` ${attrs["part_edition"]}`;
    if (attrs["part_year"] !== undefined) text += ` (${attrs["part_year"]})`;
  }
  if (attrs["annex"] !== undefined) {
    text += ` Annex ${attrs["annex"]}`;
    if (attrs["annex_edition"] !== undefined) text += ` ${attrs["annex_edition"]}`;
    if (attrs["annex_year"] !== undefined) text += ` (${attrs["annex_year"]})`;
  }
  if (attrs["appendix"] !== undefined) {
    text += ` Appendix ${attrs["appendix"]}`;
    if (attrs["appendix_subnumber"] !== undefined) text += `-${attrs["appendix_subnumber"]}`;
    if (attrs["appendix_edition"] !== undefined) text += ` ${attrs["appendix_edition"]}`;
    if (attrs["appendix_year"] !== undefined) text += ` (${attrs["appendix_year"]})`;
  }
  if (attrs["volume"] !== undefined) {
    text += ` Vol. ${attrs["volume"]}`;
    if (attrs["issue"] !== undefined) text += ` (${attrs["issue"]})`;
    if (attrs["volume_edition"] !== undefined) text += ` ${attrs["volume_edition"]}`;
    if (attrs["volume_year"] !== undefined) text += ` (${attrs["volume_year"]})`;
  }
  if (attrs["year"] !== undefined) text += ` (${attrs["year"]})`;
  return text;
}

/** The S-158 family rebind on the decode path: a draft-era part face
 *  riding number 158 rebinds onto checks_for and the spelling face
 *  drops (the decoded identifier renders the primary colon
 *  designator). */
function ihoRebindChecks(typeLetter: string, attrs: Record<string, string>): void {
  if (typeLetter !== "S" || attrs["number"] !== "158" || attrs["checks_for"] !== undefined) {
    return;
  }
  const part = attrs["part"];
  if (part === undefined) return;
  const seriesRef = /^([SPMBC])-(\d+)$/.exec(part);
  const digits = seriesRef !== null ? seriesRef[2] : /^\d+$/.test(part) ? part : undefined;
  if (digits === undefined) return;
  delete attrs["part"];
  // The edition/year that followed the draft-era part face are the
  // BASE ones (the pubid#775 mis-bind fix).
  if (attrs["edition"] === undefined && attrs["part_edition"] !== undefined) {
    attrs["edition"] = attrs["part_edition"];
  }
  if (attrs["year"] === undefined && attrs["part_year"] !== undefined) {
    attrs["year"] = attrs["part_year"];
  }
  delete attrs["part_edition"];
  delete attrs["part_year"];
  attrs["checks_for"] = digits;
}

/** The MRN guidance decode: type token, name (number + optional S-158
 *  member), the bare dotted edition, then the shared marker machinery. */
function ihoMrnText(body: string): string {
  const segments = splitParts(body);
  const typeToken = (segments.shift() ?? "").toLowerCase();
  const letter = IHO_MRN_TYPE_LETTERS[typeToken];
  if (letter === undefined) {
    throw new Error(`Unknown IHO publication type ${JSON.stringify(typeToken)} in ${JSON.stringify(body)}`);
  }
  const name = segments.shift() ?? "";
  const nameMatch = IHO_MRN_NAME_RE.exec(name);
  if (nameMatch === null) {
    throw new Error(`Unknown IHO publication name ${JSON.stringify(name)} in ${JSON.stringify(body)}`);
  }
  const attrs: Record<string, string> = { number: nameMatch[2]! };
  if (nameMatch[3] !== undefined) attrs["checks_for"] = nameMatch[3];
  if (segments[0] !== undefined && IHO_DOTTED.test(segments[0])) {
    attrs["edition"] = segments.shift()!;
  }
  ihoConsumeSegments(attrs, segments, body);
  ihoRebindChecks(letter, attrs);
  return ihoCanonicalText(letter, attrs);
}

/** The legacy positional decode: the type letter, the docnumber, a
 *  further bare digit segment binding the S-158 member (checks_for —
 *  "urn:iho:s:158:100"; another anchor rejects through the builder),
 *  then the shared marker machinery. */
function ihoLegacyText(body: string): string {
  const segments = splitParts(body);
  const typeToken = (segments.shift() ?? "").toLowerCase();
  if (!/^[spmbc]$/.test(typeToken)) {
    throw new Error(`Unknown IHO series ${JSON.stringify(typeToken)} in ${JSON.stringify(body)}`);
  }
  const number = segments.shift() ?? "";
  if (!IHO_NUMBER.test(number)) {
    throw new Error(`Missing docnumber ${JSON.stringify(number)} in ${JSON.stringify(body)}`);
  }
  const attrs: Record<string, string> = { number };
  if (segments[0] !== undefined && /^\d+$/.test(segments[0])) {
    attrs["checks_for"] = segments.shift()!;
  }
  ihoConsumeSegments(attrs, segments, body);
  ihoRebindChecks(typeToken.toUpperCase(), attrs);
  return ihoCanonicalText(typeToken.toUpperCase(), attrs);
}

// The adopted CEN spine consumes its own supplements; their urn segments
// carry the consolidation marker ("plus" = "+A1", its absence = "/A1") —
// cen_cenelec/urn_generator.rb's supplement_segments.
function adoptedSupplement(parts: string[]): string {
  let faces = "";
  while (["plus", "slash", "amd", "cor", "frag"].includes(parts[0] ?? "")) {
    let sep = "/";
    let kind: string;
    if (parts[0] === "plus" || parts[0] === "slash") {
      sep = (parts.shift() as string) === "plus" ? "+" : "/";
      kind = parts.shift() as string;
    } else {
      kind = parts.shift() as string;
    }
    const num = /^\d{1,3}$/.test(parts[0] ?? "") ? parts.shift() : undefined;
    const yr = /^\d{4}$/.test(parts[0] ?? "") ? parts.shift() : undefined;
    const iter = num ?? "";
    const year = yr !== undefined ? `:${yr}` : "";
    if (kind === "amd") faces += `${sep}A${iter}${year}`;
    else if (kind === "cor") faces += `${sep}AC${iter}${year}`;
    else faces += ` FRAG${iter}`;
  }
  return faces;
}

export const URN_PARSERS: Record<string, UrnParserDef> = {
  // lib/pubid/ansi/urn_parser.rb
  ansi: {
    prefix: "urn:ansi:",
    reconstruct(body, parse) {
      const [code, year] = splitParts(body);
      return parse(withYear(`ANSI ${code}`, year));
    },
  },

  // lib/pubid/ccsds/urn_parser.rb — the body is the full suffix.
  ccsds: {
    prefix: "urn:ccsds:",
    reconstruct(body, parse) {
      // The reference rejects cor-supplemented forms at its text parser;
      // mirrored (fixture-pinned gap).
      if (/:cor\./.test(body)) {
        throw new Error(`CCSDS URN rejected by the reference: ${JSON.stringify(body)}`);
      }
      return parse(`CCSDS ${body}`);
    },
  },

  // lib/pubid/cen_cenelec/urn_parser.rb — namespace "cen"; type token
  // uppercased before the number.
  cen_cenelec: {
    prefix: "urn:cen:",
    reconstruct(body, parse) {
      const [typeToken = "", number, year] = splitParts(body);
      return parse(withYear(`${typeToken.toUpperCase()} ${number}`, year));
    },
  },

  // lib/pubid/cie/urn_parser.rb — leading lowercase publisher + trailing
  // "sep.<x>" separator tokens are dropped.
  cie: {
    prefix: "urn:cie:",
    reconstruct(body, parse) {
      const parts = splitParts(body).filter((p) => !p.startsWith("sep."));
      const [, code, year] = parts;
      return parse(withYear(`CIE ${code}`, year));
    },
  },

  // lib/pubid/ashrae/urn_parser.rb — "ASHRAE Standard <number>-<year>".
  ashrae: {
    prefix: "urn:ashrae:",
    reconstruct(body, parse) {
      const [number, year] = splitParts(body);
      let text = `ASHRAE Standard ${number}`;
      if (year) text += `-${year}`;
      return parse(text);
    },
  },

  // lib/pubid/asme/urn_parser.rb — "ASME <code>-<year>".
  asme: {
    prefix: "urn:asme:",
    reconstruct(body, parse) {
      const [, code, year] = splitParts(body);
      let text = `ASME ${code}`;
      if (year) text += `-${year}`;
      return parse(text);
    },
  },

  // lib/pubid/astm/urn_parser.rb — year rendered to its last two digits.
  astm: {
    prefix: "urn:astm:",
    reconstruct(body, parse) {
      const [, code, year] = splitParts(body);
      let text = `ASTM ${code}`;
      if (year && year.length >= 2) text += `-${year.slice(-2)}`;
      return parse(text);
    },
  },

  // lib/pubid/iana/urn_parser.rb — "<registry>[/<sub-registry>]".
  iana: {
    prefix: "urn:iana:",
    reconstruct(body, parse) {
      const [registry = "", subRegistry] = splitParts(body);
      return parse(subRegistry ? `${registry}/${subRegistry}` : registry);
    },
  },

  // lib/pubid/idf/urn_parser.rb — empty segments dropped.
  idf: {
    prefix: "urn:idf:",
    reconstruct(body, parse) {
      const parts = splitParts(body).filter((p) => p !== "");
      const [number = "", year] = parts;
      return parse(withYear(`IDF ${number}`, year));
    },
  },
  // lib/pubid/plateau/urn_parser.rb — "PLATEAU <Type> #<number>[-<annex>]".
  plateau: {
    prefix: "urn:plateau:",
    reconstruct(body, parse) {
      const parts = splitParts(body);
      const typeToken = parts[0] ?? "";
      const number = parts[1] ?? "";
      const annex = parts[2];
      const typeMap: Record<string, string> = {
        handbook: "Handbook",
        tr: "Technical Report",
        an: "Annex",
      };
      let text = `PLATEAU ${typeMap[typeToken] ?? (typeToken.charAt(0).toUpperCase() + typeToken.slice(1))} #${number}`;
      if (annex) text += `-${annex}`;
      return parse(text);
    },
  },

  // lib/pubid/tgpp/urn_parser.rb — empty release/version segments dropped.
  tgpp: {
    prefix: "urn:3gpp:",
    reconstruct(body, parse) {
      const [type = "", code = "", release, version] = splitParts(body);
      let result = `${type.toUpperCase()} ${code}`;
      if (release !== undefined && release !== "") result += `:${release}`;
      if (version !== undefined && version !== "") result += `/${version}`;
      return parse(result);
    },
  },

  // lib/pubid/w3c/urn_parser.rb — a known type token hyphenates the rest.
  w3c: {
    prefix: "urn:w3c:",
    reconstruct(body, parse) {
      const known = ["note", "dnote", "wd", "cr", "crd", "rec", "pr", "per", "spsd", "obsl"];
      const parts = splitParts(body);
      let text: string;
      if (parts.length > 1 && known.includes(parts[0] ?? "")) {
        text = `W3C ${parts.shift()!.toUpperCase()}-${parts.shift() ?? ""}`;
      } else {
        text = `W3C ${parts.shift()}`;
      }
      if (parts.length) text += `-${parts.shift()}`;
      return parse(text);
    },
  },

  // lib/pubid/xsf/urn_parser.rb — "XEP <number>".
  xsf: {
    prefix: "urn:xsf:",
    reconstruct(body, parse) {
      const [, number] = splitParts(body);
      return parse(`XEP ${number}`);
    },
  },

  // lib/pubid/calconnect/urn_parser.rb — "CC[/series] <number>:<date>".
  calconnect: {
    prefix: "urn:calconnect:",
    reconstruct(body, parse) {
      const parts = splitParts(body);
      const date = parts.pop();
      const number = parts.pop();
      const series = parts.pop();
      let text = "CC";
      if (series !== undefined) text += `/${series}`;
      text += ` ${number}:${date}`;
      return parse(text);
    },
  },

  // lib/pubid/api/urn_parser.rb — "API STD <number>[-<part>]:<year>".
  api: {
    prefix: "urn:api:",
    reconstruct(body, parse) {
      const parts = splitParts(body);
      const number = parts[1] ?? "";
      let idx = 2;
      let part = "";
      if (parts[idx]?.startsWith("-")) {
        part = parts[idx] ?? "";
        idx += 1;
      }
      const year = parts[idx];
      let text = `API STD ${number}${part}`;
      if (year) text += `:${year}`;
      return parse(text);
    },
  },

  // lib/pubid/jis/urn_parser.rb — "JIS <code>[:<year>]".
  jis: {
    prefix: "urn:jis:",
    reconstruct(body, parse) {
      const [code = "", year] = splitParts(body);
      return parse(withYear(`JIS ${code}`, year));
    },
  },

  // lib/pubid/ietf/urn_parser.rb — rfc/bcp/std/fyi/id; unknown types raise.
  ietf: {
    prefix: "urn:ietf:",
    reconstruct(body, parse) {
      const parts = splitParts(body);
      const type = parts.shift() ?? "";
      let text: string;
      if (type === "rfc") {
        text = `RFC ${parts[0] ?? ""}`;
      } else if (type === "bcp" || type === "std" || type === "fyi") {
        text = `${type.toUpperCase()} ${parts[0] ?? ""}`;
      } else if (type === "id") {
        const [name, version] = parts;
        text = version ? `${name}-${version}` : (name ?? "");
      } else {
        throw new Error(`Invalid IETF URN type: ${JSON.stringify(type)}`);
      }
      return parse(text);
    },
  },

  // lib/pubid/ecma/urn_parser.rb — optional tr/mem tag, labelled
  // part-/ed-/vol- segments.
  ecma: {
    prefix: "urn:ecma:",
    reconstruct(body, parse) {
      const parts = splitParts(body);
      const tag = parts[0] === "tr" || parts[0] === "mem" ? parts.shift() : undefined;
      const number = parts.shift() ?? "";
      const shiftLabelled = (label: string): string | undefined =>
        parts[0]?.startsWith(label) ? parts.shift()!.slice(label.length) : undefined;
      const part = shiftLabelled("part-");
      const edition = shiftLabelled("ed-");
      const volume = shiftLabelled("vol-");
      let base: string;
      if (tag === "tr") base = `ECMA TR/${number}`;
      else if (tag === "mem") base = `ECMA MEM/${number}`;
      else base = part ? `ECMA-${number}-${part}` : `ECMA-${number}`;
      if (edition) base += ` ed${edition}`;
      if (volume) base += ` vol${volume}`;
      return parse(base);
    },
  },

  // lib/pubid/gost/urn_parser.rb — "r" prefix selects the national
  // standard; both classes render "GOST [R ]<number>-<year>".
  gost: {
    prefix: "urn:gost:std:",
    reconstruct(body, parse) {
      const parts = splitParts(body);
      if (parts[0] === "r") {
        const number = parts[1] ?? "";
        const year = parts[2];
        return parse(year ? `GOST R ${number}-${year}` : `GOST R ${number}`);
      }
      const number = parts[0] ?? "";
      const year = parts[1];
      return parse(year ? `GOST ${number}-${year}` : `GOST ${number}`);
    },
  },

  // lib/pubid/iho/urn_parser.rb — two namespaces. The EMITTED form for
  // S/P/M is the IHO MRN guidance scheme
  // "urn:mrn:iho:pub:<type>:<name>[:<dotted edition>][:<atoms>]" —
  // type spec/per/reg mapping back to the series letter, the name the
  // lowercase letter + number with the S-158 member hyphenated in
  // (s158-102), the bare dotted edition right after the name, then the
  // lowercase marker atoms. The LEGACY urn:iho: positional scheme (the
  // B/C emission; decodable for every series, never emitted for S/P/M):
  // the type letter, the docnumber, a further bare digit segment
  // binding the S-158 member ("urn:iho:s:158:100"), then the markers.
  // Legacy 2.0.x dotted keys (part./annex./suppl./ap./appendix./vol./
  // issue./y.) stay decodable, never emitted. Both paths decode onto
  // the canonical shape: the draft-era part faces rebind through the
  // builder and the spelling face drops, so a decoded identifier
  // renders the primary colon designator.
  iho: {
    prefix: "urn:mrn:iho:pub:",
    prefixes: ["urn:mrn:iho:pub:", "urn:iho:"],
    reconstruct(body, parse, prefix) {
      const text = prefix === "urn:iho:" ? ihoLegacyText(body) : ihoMrnText(body);
      return parse(text);
    },
  },

  // lib/pubid/oasis/urn_parser.rb — %20/%5D decoded after the namespace.
  oasis: {
    prefix: "urn:oasis:",
    reconstruct(body, parse) {
      const slug = body.replace(/%20|%5D/g, (m) => (m === "%20" ? " " : "]"));
      return parse(`OASIS ${slug}`);
    },
  },

  // lib/pubid/ogc/urn_parser.rb — "<year>-<number>[<revision>]".
  ogc: {
    prefix: "urn:ogc:",
    reconstruct(body, parse) {
      const [year = "", number = "", revision] = splitParts(body);
      let text = `${year}-${number}`;
      if (revision !== undefined) text += revision;
      return parse(text);
    },
  },


  // lib/pubid/amca/urn_parser.rb — keyed tokens (copub./rev./reaff./interp.),
  // a bare numeric year, and a trailing type token.
  amca: {
    prefix: "urn:amca:",
    reconstruct(body, parse) {
      const parts = splitParts(body);
      const number = parts.shift() ?? "";
      const first = parts[0];
      const year = first !== undefined && /^\d+$/.test(first) ? (parts.shift() as string) : undefined;
      const keyed: Record<string, string> = {};
      const keyedTokens: string[] = [];
      for (const token of parts) {
        if (token.includes(".")) {
          const [k, ...v] = token.split(".", 2);
          keyed[k as string] = v.join(".");
          keyedTokens.push(token);
        }
      }
      const type = parts.filter((t) => !keyedTokens.includes(t)).pop();
      const publisher = (keyed["copub"] ?? "amca").toUpperCase();
      let text: string;
      if (type === "interpretation") {
        const code = keyed["interp"]?.toUpperCase();
        text = [publisher, number, code, "Interp"].filter(Boolean).join(" ");
      } else {
        const titles: Record<string, string> = {
          standard: "Standard",
          publication: "Publication",
        };
        text = [publisher, titles[type ?? ""], number].filter(Boolean).join(" ");
        if (year) text += `-${year}`;
        if (keyed["rev"]) text += ` (Rev. ${keyed["rev"]})`;
        if (keyed["reaff"]) text += ` (R${keyed["reaff"]})`;
      }
      return parse(text);
    },
  },

  // lib/pubid/itu/urn_parser.rb — "report" segment between sector and code
  // marks an ITU-R Report; otherwise "ITU-<SECTOR> <code>".
  itu: {
    prefix: "urn:itu:",
    reconstruct(body, parse) {
      const parts = splitParts(body);
      const sector = parts[0] ?? "";
      if (parts[1] === "report") {
        return parse(`Report ITU-${sector.toUpperCase()} ${parts[2] ?? ""}`);
      }
      return parse(`ITU-${sector.toUpperCase()} ${parts[1] ?? ""}`);
    },
  },

  // lib/pubid/iala/urn_parser.rb — annex(-letter) / ed.<x> / single-letter
  // language segments after the code.
  iala: {
    prefix: "urn:mrn:iala:pub:",
    reconstruct(body, parse) {
      const parts = splitParts(body);
      const code = (parts.shift() ?? "").toUpperCase();
      let annexForm: string | undefined;
      let annexLetter: string | undefined;
      let edition: string | undefined;
      let language: string | undefined;
      for (const seg of parts) {
        const annexMatch = seg.match(/^annex(-([a-z]))?$/i);
        if (annexMatch) {
          annexLetter = annexMatch[2]?.toUpperCase();
          annexForm = annexLetter ? "ANNEX" : "Annex";
        } else if (/^ed\.?/i.test(seg)) {
          edition = seg.replace(/^ed\.?/i, "");
        } else if (/^[a-z]$/i.test(seg)) {
          language = seg.toUpperCase();
        }
      }
      let text = `IALA ${code}`;
      if (annexForm) text += ` ${annexForm}`;
      if (annexLetter) text += ` ${annexLetter}`;
      if (edition) text += ` Ed ${edition}`;
      if (language) text += ` (${language})`;
      return parse(text);
    },
  },

  // lib/pubid/bsi/urn_parser.rb — publisher token + number + year +
  // 3-segment supplement slices (amd/cor/add).
  bsi: {
    prefix: "urn:bsi:",
    reconstruct(body, parse) {
      const abbr: Record<string, string> = { amd: "Amd", cor: "Cor", add: "Add" };
      const parts = splitParts(body);
      const [publisherToken = "", number = "", year, ...supplementParts] = parts;
      let text = `${publisherToken.toUpperCase()} ${number}`;
      if (year) text += `:${year}`;
      for (let i = 0; i < supplementParts.length; i += 3) {
        const type = supplementParts[i] ?? "";
        const num = supplementParts[i + 1];
        const suppYear = supplementParts[i + 2];
        const label = abbr[type.toLowerCase()] ?? (type.charAt(0).toUpperCase() + type.slice(1));
        let suffix = num ? ` ${num}` : "";
        if (suppYear) suffix += `:${suppYear}`;
        text += `/${label}${suffix}`;
      }
      return parse(text);
    },
  },


  // lib/pubid/csa/urn_parser.rb — format.<sep> token picks the year
  // separator; the token itself is dropped.
  csa: {
    prefix: "urn:csa:",
    reconstruct(body, parse) {
      const parts = splitParts(body);
      const separators: Record<string, string> = { dash: "-", colon: ":" };
      const formatToken = parts.find((t) => t.startsWith("format."));
      const separator = separators[(formatToken?.split(".")[1]) ?? ""] ?? "-";
      const payload = parts.filter((t) => !t.startsWith("format."));
      const [, code, year] = payload;
      let text = `CSA ${code}`;
      if (year) text += `${separator}${year}`;
      return parse(text);
    },
  },

  // lib/pubid/etsi/urn_parser.rb — "ETSI <TYPE> <code> [VERSION] [(date)]".
  etsi: {
    prefix: "urn:etsi:",
    reconstruct(body, parse) {
      const parts = splitParts(body);
      const typeToken = (parts[0] ?? "").toUpperCase();
      const code = parts[1] ?? "";
      const version = parts[2];
      const date = parts[3];
      let text = `ETSI ${typeToken} ${code}`;
      if (version !== undefined) text += ` ${version.toUpperCase()}`;
      if (date !== undefined) text += ` (${date})`;
      return parse(text);
    },
  },

  // lib/pubid/evs/urn_parser.rb — reassemble the identifier's human text
  // (draft prefix, adopted org, national annex, language, supplements)
  // and delegate to the EVS grammar, exactly like the reference.
  evs: {
    prefix: "urn:evs:",
    reconstruct(body, parse) {
      const parts = splitParts(body);
      const draft = parts[0] === "pr";
      if (draft) parts.shift();
      const orgs: Record<string, string> = {
        iso: "ISO",
        "iso-iec": "ISO/IEC",
        iec: "IEC",
        cispr: "CISPR",
      };
      const types: Record<string, string> = { ts: "TS", tr: "TR" };

      // The trailing language and the EVS-level national annex peel
      // before the body dispatch — both are EVS-level, never CEN
      // segments.
      let language: string | undefined;
      const last = parts[parts.length - 1];
      if (parts.length > 1 && last !== undefined && /^(et-en|et|en)$/.test(last)) {
        language = parts.pop();
      }
      let naPresent = false;
      let naYear: string | undefined;
      const naIndex = parts.indexOf("na");
      if (naIndex >= 0) {
        parts.splice(naIndex, 1);
        naPresent = true;
        if (/^\d{4}$/.test(parts[naIndex] ?? "")) naYear = parts.splice(naIndex, 1)[0];
      }

      const head = parts.shift() ?? "";
      let text = draft ? "prEVS" : "EVS";
      if (/^en$/i.test(head)) {
        text += "-EN";
        const orgParts: string[] = [];
        while (parts[0] !== undefined && /^[a-z][a-z-]*$/.test(parts[0] as string)) {
          orgParts.push(parts.shift() as string);
        }
        if (orgParts.length) {
          const org = orgs[orgParts.join("-")];
          if (org === undefined) throw new Error(`unknown adopted org in ${JSON.stringify(body)}`);
          text += ` ${org}`;
        }
        const number = parts.shift();
        if (number === undefined) throw new Error(`missing number in ${JSON.stringify(body)}`);
        text += ` ${number}`;
        const year = parts.shift();
        if (year !== undefined) text += `:${year}`;
        text += adoptedSupplement(parts);
      } else if (head === "ts" || head === "tr") {
        const number = parts.shift();
        const year = parts.shift();
        text += `-${types[head]} ${number}`;
        if (year !== undefined) text += `:${year}`;
      } else if (head === "iso" || head === "iec" || head === "cispr") {
        const org = orgs[head];
        const number = parts.shift();
        let part: string | undefined;
        if (/^\d+$/.test(parts[0] ?? "") && !/^\d{4}$/.test(parts[0] as string) && parts.length > 1) {
          part = parts.shift();
        }
        const year = parts.shift();
        text += `-${org} ${number}`;
        if (part !== undefined) text += `-${part}`;
        if (year !== undefined) text += `:${year}`;
      } else if (/^\d/.test(head)) {
        const number = head;
        const year = parts.shift();
        text += ` ${number}`;
        if (year !== undefined) text += `:${year}`;
      } else {
        throw new Error(`unsupported shape in ${JSON.stringify(body)}`);
      }

      if (parts.length) throw new Error(`trailing segments in ${JSON.stringify(body)}`);
      if (naPresent) {
        text += "+NA";
        if (naYear !== undefined) text += `:${naYear}`;
      }
      if (language !== undefined) text += ` ${language}`;
      return parse(text);
    },
  },

  // lib/pubid/nist/urn_parser.rb — the generator dot-joins the identity's
  // fields after the number; reassemble the human spelling the flavor
  // parser reads (edition/volume glue onto the number, a revision glues
  // after them, ".supp" marks supplementability, ".supp-<v>" is "sup<v>",
  // insert/errata glue).
  nist: {
    prefix: "urn:nist:",
    reconstruct(body, parse) {
      const typeUpcase: Record<string, string> = {
        sp: "SP", fips: "FIPS", ir: "IR", nistcir: "NISTCIR", nbs: "NBS",
        nistir: "NISTIR", csf: "CSF", gcr: "GCR", itl: "ITL", jres: "JRES",
        lcirc: "LCIRC", mon: "MONO", ms: "MS", nsrds: "NSRDS", tn: "TN",
        wp: "WP",
      };
      const parts = splitParts(body);
      const typeToken = parts[0] ?? "";
      const payload = parts[1] ?? "";
      const label = typeUpcase[typeToken.toLowerCase()] ?? typeToken.toUpperCase();

      const tokens = payload.split(".");
      // Ruby's String#split drops trailing empty fields; JS keeps them, and a
      // trailing "." would become a stray marker that the flavor rejects.
      while (tokens.length > 0 && tokens[tokens.length - 1] === "") tokens.pop();
      const code = tokens.shift() ?? "";
      let marker = "";
      let part: string | undefined;
      let edition: string | undefined;
      let volume: string | undefined;
      let revision: string | undefined;
      let supplement: string | undefined;
      for (const token of tokens) {
        const supp = /^supp-(.+)$/is.exec(token);
        if (/^r\d+$/i.test(token)) revision = token;
        else if (/^e\w+$/i.test(token)) edition = token;
        else if (/^v\d+$/i.test(token)) volume = token;
        else if (supp !== null) supplement = supp[1];
        else if (token === "supp") continue; // supplementability marker
        else if (token === "insert" || token === "errata") marker += token;
        else if (/^[A-Z]$/.test(token)) part = token; // part letter, glued to the code
        else if (/^[A-Z][a-z]+\d{4}$/.test(token)) {
          // the edition's additional text ("13e2.June1908")
          if (edition !== undefined) edition = `${edition}.${token}`;
        } else marker += `.${token}`;
      }

      // The NBS-era series carry the NBS imprint in their canonical form
      // ("NBS CSM 1") — the rebuild names the publisher the document
      // carries, or the flavor parse rejects its own URN's rebuild.
      const publisher = typeToken.toLowerCase() === "csm" ? "NBS" : "NIST";
      let text = `${publisher} ${label} ${code}${part ?? ""}${marker}`;
      text += `${edition ?? ""}${volume ?? ""}${revision ?? ""}`;
      if (supplement !== undefined) text += `sup${supplement}`;
      return parse(text);
    },
  },

  // lib/pubid/easc/urn_parser.rb — "urn:easc:<series>[:v]:<number>[:<year>]";
  // the human face renders the Cyrillic series label
  // ("ПМГ 02-2008", "ПМГ В 31-2001", "РМГ 151-2025").
  easc: {
    prefix: "urn:easc:",
    reconstruct(body, parse) {
      const parts = body.split(":");
      const series = parts.shift() ?? "";
      if (series === "") {
        throw new Error(`EASC URN missing series: ${JSON.stringify(body)}`);
      }
      const label = series.toUpperCase() === "PMG" ? "ПМГ" : "РМГ";
      let rest = parts;
      let separator = " ";
      if (/^v$/i.test(rest[0] ?? "")) {
        separator = " В ";
        rest = rest.slice(1);
      }
      const number = rest[0] ?? "";
      let text = `${label}${separator}${number}`;
      if (rest[1] !== undefined) text += `-${rest[1]}`;
      return parse(text);
    },
  },

  // lib/pubid/ieee/urn_parser.rb — "IEEE Std <code>[-<year>]". The fixture
  // pins the reference's own parse failures for narrative/artifact rows.
  ieee: {
    prefix: "urn:ieee:",
    reconstruct(body, parse) {
      const parts = splitParts(body);
      const [, code, year] = parts;
      let text = `IEEE Std ${code}`;
      // A "-YYYY-MM" tail is a dated reference (year + numeric month),
      // mirroring the gem's urn parser; it re-parses through the
      // trailing-month-year clause so the render prints "21, 11 1976"
      // like the reference.
      const dated = /^(.*)-(\d{4})-(\d{2})$/.exec(text);
      if (dated) return parse(`${dated[1]}, ${dated[3]} ${dated[2]}`);
      if (year) text += `-${year}`;
      return parse(text);
    },
  },

  // lib/pubid/wmo/urn_parser.rb — the MRN segments of the widening: the
  // code resolves the series slug ("wmo-td-"/"wmo-"/"jcomm-tr-"/"gaw-"
  // publications, longest slug first; "s-" the S-100 specs). A
  // publication takes the caseless volume ("vol-i.1"), status
  // ("status-provisional"), updated-in ("updated-2025") and one
  // "ed<year>" (the year pair hyphenated, "ed2021-2018") segments; an
  // "s-" code takes a caseless annex segment (at most one, rebuilt as
  // the attested "Annex" face) then the dotted edition. Every other
  // segment must be "ed" + the shape the code declares (a year for a
  // publication, dotted for a standard) — per the ISO urn_parser
  // strictness. The rebuild walks the comma-optional faces and the text
  // parser normalizes (one construction path).
  wmo: {
    prefix: "urn:mrn:wmo:pub:",
    reconstruct(body, parse) {
      const parts = splitParts(body);
      const code = parts[0];
      if (code === undefined) {
        throw new Error(`Invalid WMO URN code segment: ${JSON.stringify(code)}`);
      }
      const segments = parts.slice(1);
      const editionValue = (seg: string, shape: RegExp): string => {
        if (!/^ed/i.test(seg)) {
          throw new Error(`Invalid WMO URN segment: ${JSON.stringify(seg)}`);
        }
        const edition = seg.replace(/^ed/i, "");
        if (!shape.test(edition)) {
          throw new Error(`Invalid WMO URN segment: ${JSON.stringify(seg)}`);
        }
        return edition;
      };
      // Longest slug first: "wmo-td-" also starts with "wmo-". The face
      // is the series key's citation face (the gem reads
      // Identifier.series_config(series)[:face]).
      const SERIES_CODES: [slug: string, series: string | undefined, face: string][] = [
        ["wmo-td-", "TD", "WMO/TD-No."],
        ["wmo-", undefined, "WMO-No."],
        ["jcomm-tr-", "JCOMM", "JCOMM Technical Report No."],
        ["gaw-", "GAW", "GAW Report No."],
      ];
      const publicationCode = SERIES_CODES
        .map(([slug, series, face]) => ({
          series,
          face,
          match: new RegExp(`^${slug}(\\d+)$`, "i").exec(code),
        }))
        .find(({ match }) => match !== null);
      if (publicationCode !== undefined) {
        let volume: string | undefined;
        let status: string | undefined;
        let edition: string | undefined;
        let updatedIn: string | undefined;
        for (const seg of segments) {
          const vol = /^vol-([a-z]+(?:\.\d+)*)$/i.exec(seg);
          if (vol !== null) {
            if (volume !== undefined) {
              throw new Error(`Invalid WMO URN segment (duplicate volume): ${JSON.stringify(seg)}`);
            }
            volume = vol[1]!.toUpperCase();
            continue;
          }
          const stat = /^status-([a-z]+)$/i.exec(seg);
          if (stat !== null) {
            if (status !== undefined) {
              throw new Error(`Invalid WMO URN segment (duplicate status): ${JSON.stringify(seg)}`);
            }
            status = stat[1]!.charAt(0).toUpperCase() + stat[1]!.slice(1);
            continue;
          }
          const updated = /^updated-(\d{4})$/i.exec(seg);
          if (updated !== null) {
            if (updatedIn !== undefined) {
              throw new Error(`Invalid WMO URN segment (duplicate updated): ${JSON.stringify(seg)}`);
            }
            updatedIn = updated[1];
            continue;
          }
          if (edition !== undefined) {
            throw new Error(`Invalid WMO URN segment (duplicate edition): ${JSON.stringify(seg)}`);
          }
          // The year pair keeps its slash out of the NSS as a hyphen;
          // the rebuild restores it ("ed2021-2018" -> "2021/2018").
          edition = editionValue(seg, /^\d{4}(?:-\d{4})?$/).replaceAll("-", "/");
        }
        let text = `${publicationCode.face} ${publicationCode.match![1]}`;
        if (volume !== undefined) text += ` Volume ${volume}`;
        if (edition !== undefined) {
          text += status !== undefined
            ? `, ${status} ${edition} edition`
            : `, ${edition} edition`;
        }
        if (updatedIn !== undefined) text += `, updated in ${updatedIn}`;
        return parse(text);
      }
      const standard = /^s-(\d+)$/i.exec(code);
      if (standard !== null) {
        let annexLetter: string | undefined;
        let edition: string | undefined;
        let hasAnnex = false;
        for (const seg of segments) {
          const annex = /^annex(-([a-z]))?$/i.exec(seg);
          if (annex !== null) {
            if (hasAnnex) {
              throw new Error(`Invalid WMO URN segment (duplicate annex): ${JSON.stringify(seg)}`);
            }
            hasAnnex = true;
            annexLetter = annex[2]?.toUpperCase();
          } else {
            if (edition !== undefined) {
              throw new Error(`Invalid WMO URN segment: ${JSON.stringify(seg)}`);
            }
            edition = editionValue(seg, /^\d+(\.\d+)+$/);
          }
        }
        // The annex segment is caseless in the MRN, so the rebuild picks
        // the attested WMO face "Annex" (the DCEG docidentifier); the
        // uppercase "ANNEX" form stays a parse-only human alias.
        let text = `S-${standard[1]}`;
        if (hasAnnex) text += " Annex";
        if (annexLetter !== undefined) text += ` ${annexLetter}`;
        if (edition !== undefined) text += ` ${edition}`;
        return parse(text);
      }
      throw new Error(`Invalid WMO URN code segment: ${JSON.stringify(code)}`);
    },
  },
}

export function lookupUrnParser(flavor: string): UrnParserDef | undefined {
  return URN_PARSERS[flavor];
}

export function parseUrnFor(
  def: UrnParserDef,
  urn: string,
  parse: (text: string) => Identifier,
): Identifier {
  const prefixes = def.prefixes ?? [def.prefix];
  const hit = prefixes.find((p) => urn.toLowerCase().startsWith(p));
  if (hit === undefined) {
    throw new Error(`Invalid ${def.prefix.toUpperCase()} URN: ${JSON.stringify(urn)}`);
  }
  return def.reconstruct(urn.slice(hit.length), parse, hit);
}
