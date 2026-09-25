import type { Identifier } from "../conformance/implementation.js";
import { splitParts, withYear, type UrnParserDef } from "./types.js";

// Each parser mirrors lib/pubid/<flavor>/urn_parser.rb#parse_urn exactly —
// including its lossiness (dropped segments stay dropped) and its error
// cases. The parity fixture (test/fixtures/urn-parity.json) pins the
// reference behavior for ~93k corpus URNs.

export const URN_PARSERS: Record<string, UrnParserDef> = {
  // lib/pubid/ansi/urn_parser.rb
  ansi: {
    namespace: "ansi",
    reconstruct(body, parse) {
      const [code, year] = splitParts(body);
      return parse(withYear(`ANSI ${code}`, year));
    },
  },

  // lib/pubid/ccsds/urn_parser.rb — the body is the full suffix.
  ccsds: {
    namespace: "ccsds",
    reconstruct(body, parse) {
      return parse(`CCSDS ${body}`);
    },
  },

  // lib/pubid/cen_cenelec/urn_parser.rb — namespace "cen"; type token
  // uppercased before the number.
  cen_cenelec: {
    namespace: "cen",
    reconstruct(body, parse) {
      const [typeToken = "", number, year] = splitParts(body);
      return parse(withYear(`${typeToken.toUpperCase()} ${number}`, year));
    },
  },

  // lib/pubid/cie/urn_parser.rb — leading lowercase publisher + trailing
  // "sep.<x>" separator tokens are dropped.
  cie: {
    namespace: "cie",
    reconstruct(body, parse) {
      const parts = splitParts(body).filter((p) => !p.startsWith("sep."));
      const [, code, year] = parts;
      return parse(withYear(`CIE ${code}`, year));
    },
  },

  // lib/pubid/ashrae/urn_parser.rb — "ASHRAE Standard <number>-<year>".
  ashrae: {
    namespace: "ashrae",
    reconstruct(body, parse) {
      const [number, year] = splitParts(body);
      let text = `ASHRAE Standard ${number}`;
      if (year) text += `-${year}`;
      return parse(text);
    },
  },

  // lib/pubid/asme/urn_parser.rb — "ASME <code>-<year>".
  asme: {
    namespace: "asme",
    reconstruct(body, parse) {
      const [, code, year] = splitParts(body);
      let text = `ASME ${code}`;
      if (year) text += `-${year}`;
      return parse(text);
    },
  },

  // lib/pubid/astm/urn_parser.rb — year rendered to its last two digits.
  astm: {
    namespace: "astm",
    reconstruct(body, parse) {
      const [, code, year] = splitParts(body);
      let text = `ASTM ${code}`;
      if (year && year.length >= 2) text += `-${year.slice(-2)}`;
      return parse(text);
    },
  },

  // lib/pubid/iana/urn_parser.rb — "<registry>[/<sub-registry>]".
  iana: {
    namespace: "iana",
    reconstruct(body, parse) {
      const [registry = "", subRegistry] = splitParts(body);
      return parse(subRegistry ? `${registry}/${subRegistry}` : registry);
    },
  },

  // lib/pubid/idf/urn_parser.rb — empty segments dropped.
  idf: {
    namespace: "idf",
    reconstruct(body, parse) {
      const parts = splitParts(body).filter((p) => p !== "");
      const [number = "", year] = parts;
      return parse(withYear(`IDF ${number}`, year));
    },
  },
  // lib/pubid/plateau/urn_parser.rb — "PLATEAU <Type> #<number>[-<annex>]".
  plateau: {
    namespace: "plateau",
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
    namespace: "3gpp",
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
    namespace: "w3c",
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
    namespace: "xsf",
    reconstruct(body, parse) {
      const [, number] = splitParts(body);
      return parse(`XEP ${number}`);
    },
  },

  // lib/pubid/calconnect/urn_parser.rb — "CC[/series] <number>:<date>".
  calconnect: {
    namespace: "calconnect",
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
    namespace: "api",
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
}

export function lookupUrnParser(flavor: string): UrnParserDef | undefined {
  return URN_PARSERS[flavor];
}

export function parseUrnFor(
  def: UrnParserDef,
  urn: string,
  parse: (text: string) => Identifier,
): Identifier {
  const prefix = `urn:${def.namespace}:`;
  if (!urn.toLowerCase().startsWith(prefix)) {
    throw new Error(`Invalid ${def.namespace.toUpperCase()} URN: ${JSON.stringify(urn)}`);
  }
  return def.reconstruct(urn.slice(prefix.length), parse);
}
