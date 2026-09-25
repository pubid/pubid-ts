import type { Identifier } from "../conformance/implementation.js";
import { splitParts, withYear, type UrnParserDef } from "./types.js";
import type { BaseIdentifier } from "../model/identifier.js";
import { grammarImplementation } from "../flavors/index.js";
import { NationalAdoption } from "../flavors/evs/model.js";

// Each parser mirrors lib/pubid/<flavor>/urn_parser.rb#parse_urn exactly —
// including its lossiness (dropped segments stay dropped) and its error
// cases. The parity fixture (test/fixtures/urn-parity.json) pins the
// reference behavior for ~93k corpus URNs.

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

  // lib/pubid/iho/urn_parser.rb — "IHO <TYPE>-<number> [<Part label>
  // <value>] [<version>]".
  iho: {
    prefix: "urn:iho:",
    reconstruct(body, parse) {
      const partLabels: Record<string, string> = {
        part: "Part",
        ap: "Ap.",
        annex: "Annex",
        suppl: "Suppl",
      };
      const parts = splitParts(body);
      const typeToken = (parts[0] ?? "").toUpperCase();
      const number = parts[1] ?? "";
      let idx = 2;
      let partLabel: string | undefined;
      const kindToken = parts[idx];
      if (kindToken !== undefined && /^[a-z]+\./i.test(kindToken)) {
        const [kind = "", value = ""] = kindToken.split(".", 2);
        const label = partLabels[kind.toLowerCase()] ?? (kind.charAt(0).toUpperCase() + kind.slice(1));
        partLabel = `${label} ${value}`;
        idx += 1;
      }
      const version = parts[idx];
      let text = `IHO ${typeToken}-${number}`;
      if (partLabel) text += ` ${partLabel}`;
      if (version) text += ` ${version}`;
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

  // lib/pubid/evs/urn_parser.rb — EN [org] number[:year] with an optional
  // amd/cor iteration tail; the rebuilt text is parsed as a CEN adoption.
  evs: {
    prefix: "urn:evs:",
    reconstruct(body, parse) {
      const parts = splitParts(body);
      const type = parts.shift() ?? "";
      if (type.toLowerCase() !== "en") {
        throw new Error(`unsupported type in ${JSON.stringify(body)}`);
      }
      const orgs: Record<string, string> = {
        iso: "ISO",
        "iso-iec": "ISO/IEC",
        iec: "IEC",
        cispr: "CISPR",
      };
      const orgParts: string[] = [];
      while (parts[0] !== undefined && /^[a-z][a-z-]*$/.test(parts[0])) {
        orgParts.push(parts.shift() as string);
      }
      let text = "EN";
      if (orgParts.length) {
        const org = orgs[orgParts.join("-")];
        if (org === undefined) throw new Error(`unknown adopted org in ${JSON.stringify(body)}`);
        text += ` ${org}`;
      }
      const number = parts.shift();
      if (number === undefined) throw new Error(`missing number in ${JSON.stringify(body)}`);
      text += ` ${number}`;
      const year = parts.shift();
      if (year) text += `:${year}`;
      if (parts.length) {
        const yearTail = parts[parts.length - 1]?.match(/^\d{4}$/) ? (parts.pop() as string) : undefined;
        const kind = parts.shift();
        const iteration = parts.shift();
        if (kind !== "amd" && kind !== "cor") {
          throw new Error(`malformed supplement in ${JSON.stringify(body)}`);
        }
        if (iteration === undefined || parts.length) {
          throw new Error(`malformed supplement in ${JSON.stringify(body)}`);
        }
        text += kind === "amd" ? `/A${iteration}` : `/AC${iteration}`;
        if (yearTail) text += `:${yearTail}`;
      }
      // The reference constructs NationalAdoption around a parsed CEN
      // base (lib/pubid/evs/urn_parser.rb) rather than re-parsing the
      // rebuilt text as EVS.
      const cen = grammarImplementation("cen_cenelec")!;
      const base = cen.parse(text) as unknown as BaseIdentifier;
      return new NationalAdoption({ base }) as unknown as Identifier;
    },
  },

  // lib/pubid/nist/urn_parser.rb — type token upcased via the reference
  // map; ".supp" stripped; ".r<N>" revision suffix split off the payload.
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
      const stripped = payload.replace(/\.supp$/, "");
      const revMatch = stripped.match(/^(.*)\.(r\d+)$/i);
      const code = revMatch ? revMatch[1] : stripped;
      const revision = revMatch ? revMatch[2] : undefined;
      let text = `NIST ${label} ${code}`;
      if (revision) text += revision;
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
      if (year) text += `-${year}`;
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
  const prefix = def.prefix;
  if (!urn.toLowerCase().startsWith(prefix)) {
    throw new Error(`Invalid ${def.prefix.toUpperCase()} URN: ${JSON.stringify(urn)}`);
  }
  return def.reconstruct(urn.slice(prefix.length), parse);
}
