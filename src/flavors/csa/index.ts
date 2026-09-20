import type { Tree, TreeObject } from "../../grammar/engine.js";
import { parseGrammar } from "../../grammar/engine.js";
import type { FlavorImplementation, Identifier } from "../../conformance/implementation.js";
import { grammarImplementation } from "../index.js";
import { csaGrammar, normalizeCsa, csaPublisherPrefix } from "./grammar.js";
import {
  BundledClass,
  CanadianAdoptedClass,
  CecClass,
  CombinedClass,
  CsaAdoptedClass,
  CsaIdentifier,
  CsaSingleIdentifier,
  PackageClass,
  SeriesClass,
  StandardClass,
} from "./model.js";
import type { IdentifierStatic } from "../../model/identifier.js";

/**
 * Port of lib/pubid/csa/builder.rb + the Identifier.parse pre-parse
 * logic (identifier.rb): CAN/, CAN3-, CSA-adoption, and PACKAGE
 * wrappers; the parser's own normalization + prefix injection.
 */

const isObj = (v: unknown): v is TreeObject =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const strv = (v: unknown): string | undefined => {
  if (v === undefined || v === null) return undefined;
  if (Array.isArray(v)) {
    const flat = (v as unknown[]).flat(10);
    const joined = flat.map(String).join("");
    return joined.length > 0 ? joined : undefined;
  }
  const s = String(v).trim();
  return s.length > 0 ? s : undefined;
};

function flatten(data: Tree): TreeObject {
  return Array.isArray(data) ? (Object.assign({}, ...data) as TreeObject) : (data as TreeObject);
}

type Ctor = new (attrs?: Record<string, unknown>) => CsaIdentifier;
const ctor = (klass: IdentifierStatic): Ctor => klass as unknown as Ctor;

function tryForeign(flavor: string, raw: string): Identifier | undefined {
  const impl = grammarImplementation(flavor);
  if (impl === undefined) return undefined;
  try {
    return impl.parse(raw);
  } catch {
    return undefined;
  }
}

// --- Single identifiers (builder.rb build_single + friends) ---------------------------

function expandYear(yearStr: string, prefix: string | undefined): string {
  if (yearStr.length === 2) {
    if (prefix === "M") return `19${yearStr}`;
    return Number(yearStr) < 50 ? `20${yearStr}` : `19${yearStr}`;
  }
  return yearStr;
}

function setReaffirmation(target: CsaSingleIdentifier, data: Record<string, unknown>): void {
  const self = target as unknown as Record<string, unknown>;
  if (data["reaffirmation_4digit"] !== undefined) {
    self["reaffirmation"] = strv(data["reaffirmation_4digit"]);
    self["original_reaffirmation_4digit"] = true;
  } else if (data["reaffirmation_2digit"] !== undefined) {
    const two = strv(data["reaffirmation_2digit"]) ?? "";
    self["reaffirmation"] = Number(two) < 50 ? `20${two}` : `19${two}`;
    self["original_reaffirmation_4digit"] = false;
  } else if (data["reaffirmation"] !== undefined) {
    const raw = data["reaffirmation"];
    self["reaffirmation"] = isObj(raw)
      ? strv((raw as TreeObject)["year"])
      : strv(raw);
  }
}

function selectSingleClass(data: Record<string, unknown>): IdentifierStatic {
  if (data["no_notation"] !== undefined && data["no_number"] !== undefined) return CecClass;
  if (data["series_type"] !== undefined) return SeriesClass;
  if (data["series"] !== undefined && strv(data["series"]) === "SERIES") return SeriesClass;
  return StandardClass;
}

function buildSingle(dataIn: TreeObject): CsaSingleIdentifier {
  const data = dataIn as Record<string, unknown>;
  const identifier = new (ctor(selectSingleClass(data)) as unknown as new (attrs?: Record<string, unknown>) => CsaSingleIdentifier)();
  const self = identifier as unknown as Record<string, unknown>;

  if (data["publisher_prefix"] !== undefined) {
    self["publisher_prefix"] = strv(data["publisher_prefix"]);
  } else if (data["code"] !== undefined) {
    self["code_only"] = true;
  }

  if (data["has_publisher"] !== undefined) self["has_publisher"] = true;

  if (data["code"] !== undefined && !(identifier instanceof (CecClass as unknown as Function))) {
    const codeValue = strv(data["code"]) ?? "";
    const m = !data["year"] ? /^(.+)-(\d{2})$/.exec(codeValue) : null;
    if (m !== null) {
      self["number"] = m[1];
      self["year"] = `20${m[2]}`;
      self["year_format"] = "dash";
    } else {
      self["number"] = codeValue;
    }
  }

  if (identifier instanceof (CecClass as unknown as Function)) {
    if (data["code"] !== undefined && self["cec_part"] === undefined) {
      self["cec_part"] = strv(data["code"]);
    }
    if (data["no_number"] !== undefined) {
      self["no_number"] = strv(data["no_number"]);
    }
    if (self["cec_part"] !== undefined && self["no_number"] !== undefined) {
      self["number"] = `${self["cec_part"]}-${self["no_number"]}`;
    }
  }

  if (data["series_prefix"] !== undefined) self["series_prefix"] = strv(data["series_prefix"]);
  if (data["series"] !== undefined) self["series"] = true;

  const yearFormat = data["dash_format"] !== undefined
    ? "dash"
    : "colon";

  if (data["year"] !== undefined && self["year"] === undefined) {
    const yearStr = strv(data["year"]) ?? "";
    self["year"] = expandYear(yearStr, strv(data["year_prefix"]));
    if (yearStr.length === 4) self["original_year_4digit"] = true;
    self["year_format"] = yearFormat;
  }

  if (data["year_prefix"] !== undefined) {
    self["year_prefix"] = strv(data["year_prefix"]);
    if (strv(data["year_prefix"]) === "F") self["french"] = true;
  }
  if (data["french"] !== undefined) self["french"] = true;

  setReaffirmation(identifier, data);

  if (data["package_portion"] !== undefined) {
    self["package"] = strv(data["package_portion"]);
  }

  return identifier;
}

function buildSeries(dataIn: TreeObject): CsaSingleIdentifier {
  const data = dataIn as Record<string, unknown>;
  const series = new (ctor(SeriesClass) as unknown as new (attrs?: Record<string, unknown>) => CsaSingleIdentifier)();
  const self = series as unknown as Record<string, unknown>;

  self["series"] = true;
  if (data["publisher_prefix"] !== undefined) self["publisher_prefix"] = strv(data["publisher_prefix"]);
  if (data["series_prefix"] !== undefined) self["series_prefix"] = strv(data["series_prefix"]);
  if (data["code"] !== undefined) self["number"] = strv(data["code"]);

  if (data["year"] !== undefined) {
    const yearStr = strv(data["year"]) ?? "";
    self["year"] = expandYear(yearStr, strv(data["year_prefix"]));
    if (yearStr.length === 4) self["original_year_4digit"] = true;
    self["year_format"] = data["dash_format"] !== undefined ? "dash" : "colon";
  }
  if (data["year_prefix"] !== undefined) self["year_prefix"] = strv(data["year_prefix"]);
  setReaffirmation(series, data);
  return series;
}

function buildCec(dataIn: TreeObject): CsaSingleIdentifier {
  const data = dataIn as Record<string, unknown>;
  const cec = new (ctor(CecClass) as unknown as new (attrs?: Record<string, unknown>) => CsaSingleIdentifier)();
  const self = cec as unknown as Record<string, unknown>;

  if (data["publisher_prefix"] !== undefined) self["publisher_prefix"] = strv(data["publisher_prefix"]);
  if (data["cec_part"] !== undefined) self["cec_part"] = strv(data["cec_part"]);
  if (data["no_number"] !== undefined) self["no_number"] = strv(data["no_number"]);
  if (self["cec_part"] !== undefined && self["no_number"] !== undefined) {
    self["number"] = `${self["cec_part"]}-${self["no_number"]}`;
  }

  if (data["year"] !== undefined) {
    const yearStr = strv(data["year"]) ?? "";
    self["year"] = expandYear(yearStr, strv(data["year_prefix"]));
    if (yearStr.length === 4) self["original_year_4digit"] = true;
    self["year_format"] = data["dash_format"] !== undefined ? "dash" : "colon";
  }
  if (data["year_prefix"] !== undefined) {
    self["year_prefix"] = strv(data["year_prefix"]);
    if (strv(data["year_prefix"]) === "F") self["french"] = true;
  }
  if (data["french"] !== undefined) self["french"] = true;
  setReaffirmation(cec, data);
  return cec;
}

// --- The builder dispatch ---------------------------------------------------------------

function buildTree(parsed: TreeObject): Identifier {
  const data = parsed as Record<string, unknown>;

  if (data["publisher_prefix"] !== undefined
    && ["CAN/CSA-", "CAN3-"].includes(strv(data["publisher_prefix"]) ?? "")) {
    return buildCanadianAdopted(data);
  }
  if ("adoption_number" in data) return buildAdoption(data);
  if ("series_type" in data) return buildSeries(parsed);
  if ("cec_part" in data) return buildCec(parsed);
  if ("package_portion" in data) return buildPackage(parsed);
  if ("bundled_first" in data) return buildBundled(data);
  if (data["first"] !== undefined && data["second"] !== undefined) return buildCombined(data);
  return buildSingle(parsed);
}

function buildPackage(data: Record<string, unknown>): Identifier {
  const baseData = { ...data };
  delete baseData["package_portion"];
  return new (ctor(PackageClass))({
    base: buildSingle(baseData as TreeObject),
    ...(data["package_portion"] !== undefined
      ? { package_materials: strv(data["package_portion"]) }
      : {}),
  }) as unknown as Identifier;
}

function parseAdoptionBase(adoptionOrg: string, baseStr: string): Identifier {
  if (adoptionOrg.startsWith("ISO") || adoptionOrg.startsWith("CEI")) {
    return tryForeign("iso", baseStr)!;
  }
  if (adoptionOrg.startsWith("IEC")) {
    return tryForeign("iec", baseStr)!;
  }
  return tryForeign("iso", baseStr) ?? tryForeign("iec", baseStr)!;
}

function buildAdoption(data: Record<string, unknown>): Identifier {
  let adoptionOrg = strv(data["adoption_org"]) ?? "";
  const adoptionNumber = strv(data["adoption_number"]) ?? "";
  const adoptionYear = strv(data["adoption_year"]) ?? "";
  if (data["iso_type"] !== undefined) adoptionOrg += ` ${strv(data["iso_type"])}`;
  const yearSep = strv(data["adoption_year_sep"]) ?? ":";
  const wrappedYear = adoptionYear.length === 2 ? `20${adoptionYear}` : adoptionYear;

  let base: Identifier;
  if (data["adoption_amendment"] !== undefined) {
    const baseStr = `${adoptionOrg} ${adoptionNumber}${yearSep}${wrappedYear}`;
    const amendmentYear = strv(data["adoption_amendment_year"]) ?? "";
    const wrappedAmendmentYear = amendmentYear.length === 2 ? `20${amendmentYear}` : amendmentYear;
    const amendmentStr = `${baseStr}/Amd ${strv(data["adoption_amendment"])}:${wrappedAmendmentYear}`;
    base = parseAdoptionBase(adoptionOrg, amendmentStr);
  } else {
    let wrappedIdStr = `${adoptionOrg} ${adoptionNumber}${yearSep}${wrappedYear}`;
    if (adoptionOrg === "CEI/IEC") {
      wrappedIdStr = wrappedIdStr.replace("CEI/IEC", "IEC");
    }
    base = parseAdoptionBase(adoptionOrg, wrappedIdStr);
  }

  const self: Record<string, unknown> = { base };
  if (data["reaffirmation_4digit"] !== undefined) {
    self["reaffirmation"] = strv(data["reaffirmation_4digit"]);
  } else if (data["reaffirmation_2digit"] !== undefined) {
    const two = strv(data["reaffirmation_2digit"]) ?? "";
    self["reaffirmation"] = Number(two) < 50 ? `20${two}` : `19${two}`;
  } else if (data["reaffirmation"] !== undefined) {
    const raw = data["reaffirmation"];
    self["reaffirmation"] = isObj(raw) ? strv((raw as TreeObject)["year"]) : strv(raw);
  }
  return new (ctor(CsaAdoptedClass))(self) as unknown as Identifier;
}

function buildCanadianAdopted(data: Record<string, unknown>): Identifier {
  const originalPrefix = strv(data["publisher_prefix"]);
  const wrappedData = { ...data };
  delete wrappedData["publisher_prefix"];

  let base: CsaIdentifier;
  if ("series_type" in wrappedData) {
    base = buildSeries(wrappedData as TreeObject);
    if (originalPrefix !== undefined) {
      (base as unknown as Record<string, unknown>)["publisher_prefix"] = originalPrefix;
    }
  } else if ("cec_part" in wrappedData) {
    base = buildCec(wrappedData as TreeObject);
    if (originalPrefix !== undefined) {
      (base as unknown as Record<string, unknown>)["publisher_prefix"] = originalPrefix;
    }
  } else {
    base = buildSingle(wrappedData as TreeObject);
    if (originalPrefix !== undefined) {
      (base as unknown as Record<string, unknown>)["publisher_prefix"] = originalPrefix;
    }
  }

  const self: Record<string, unknown> = { base };
  if (data["reaffirmation_4digit"] !== undefined) {
    self["reaffirmation"] = strv(data["reaffirmation_4digit"]);
  } else if (data["reaffirmation_2digit"] !== undefined) {
    const two = strv(data["reaffirmation_2digit"]) ?? "";
    self["reaffirmation"] = Number(two) < 50 ? `20${two}` : `19${two}`;
  }
  return new (ctor(CanadianAdoptedClass))(self) as unknown as Identifier;
}

function buildBundled(data: Record<string, unknown>): Identifier {
  const base = buildSingle(flatten(data["base"] as Tree));
  const portions: TreeObject[] = [flatten(data["bundled_first"] as Tree)];
  const rest = data["bundled_rest"];
  if (rest !== undefined && (!Array.isArray(rest) || rest.length > 0)) {
    const restArr = (Array.isArray(rest)
      ? (rest as unknown[]).flat(10)
      : [rest])
      .filter((x) => isObj(x));
    for (const portion of restArr) {
      portions.push(flatten(portion as Tree));
    }
  }

  const self: Record<string, unknown> = {
    base,
    bundled_with: portions.map((p) => buildSingle(p)),
  };
  if (data["reaffirmation_4digit"] !== undefined) {
    self["reaffirmation"] = strv(data["reaffirmation_4digit"]);
    self["original_reaffirmation_4digit"] = true;
  } else if (data["reaffirmation_2digit"] !== undefined) {
    const two = strv(data["reaffirmation_2digit"]) ?? "";
    self["reaffirmation"] = Number(two) < 50 ? `20${two}` : `19${two}`;
  }
  return new (ctor(BundledClass))(self) as unknown as Identifier;
}

function buildCombined(data: Record<string, unknown>): Identifier {
  const parts = (["first", "second", "third"] as const)
    .map((key) => data[key])
    .filter((v) => v !== undefined)
    .map((v) => buildSingle(flatten(v as Tree)));

  const self: Record<string, unknown> = {
    identifiers: parts,
    separator: data["comma_separator"] !== undefined ? ", " : "/",
  };
  if (data["reaffirmation_4digit"] !== undefined) {
    self["reaffirmation"] = strv(data["reaffirmation_4digit"]);
    self["original_reaffirmation_4digit"] = true;
  } else if (data["reaffirmation_2digit"] !== undefined) {
    const two = strv(data["reaffirmation_2digit"]) ?? "";
    self["reaffirmation"] = Number(two) < 50 ? `20${two}` : `19${two}`;
  } else if (data["reaffirmation"] !== undefined) {
    self["reaffirmation"] = strv(data["reaffirmation"]);
  }
  if (data["package_portion"] !== undefined) {
    self["package"] = strv(data["package_portion"]);
  }
  return new (ctor(CombinedClass))(self) as unknown as Identifier;
}

// --- The parser entry (parser.rb parse + prefix injection) -------------------------------

function injectPublisherPrefix(hash: Record<string, unknown>, prefix: string): void {
  const first = hash["first"];
  if (isObj(first)) (first as Record<string, unknown>)["publisher_prefix"] = prefix;
  const second = hash["second"];
  if (isObj(second)
    && (hash["comma_separator"] !== undefined || (second as Record<string, unknown>)["has_publisher"] !== undefined)) {
    (second as Record<string, unknown>)["publisher_prefix"] = prefix;
  }
  const third = hash["third"];
  if (isObj(third) && (third as Record<string, unknown>)["has_publisher"] !== undefined) {
    (third as Record<string, unknown>)["publisher_prefix"] = prefix;
  }
  const base = hash["base"];
  if (isObj(base)) injectPublisherPrefix(base as Record<string, unknown>, prefix);
  if (hash["first"] === undefined && hash["base"] === undefined && hash["bundled_first"] === undefined) {
    hash["publisher_prefix"] = prefix;
  }
}

function parseTree(input: string): TreeObject {
  const normalized = normalizeCsa(input);
  const prefix = csaPublisherPrefix(normalized);
  const tree = parseGrammar(csaGrammar, normalized);
  const hash = flatten(tree) as Record<string, unknown>;
  if (prefix !== undefined) injectPublisherPrefix(hash, prefix);
  return hash as TreeObject;
}

// --- Identifier.parse (identifier.rb) ------------------------------------------------------

function tryParse(input: string): Identifier | undefined {
  try {
    return parseCsa(input);
  } catch {
    return undefined;
  }
}

function extractReaffirmation(wrappedInput: string): { year: string | undefined; was4digit: boolean; rest: string } {
  const m = /\(R(\d{2,4})\)/.exec(wrappedInput);
  if (m === null) return { year: undefined, was4digit: false, rest: wrappedInput };
  let year = m[1]!;
  const was4digit = year.length === 4;
  if (year.length === 2) {
    year = Number(year) < 50 ? `20${year}` : `19${year}`;
  }
  const rest = wrappedInput.replace(/\s*\(R\d{2,4}\)/, "");
  return { year, was4digit, rest };
}

function setPublisherPrefix(obj: CsaIdentifier, prefix: string): void {
  const self = obj as unknown as Record<string, unknown>;
  self["publisher_prefix"] = prefix;
  const combined = self["identifiers"] as CsaIdentifier[] | undefined;
  if (combined !== undefined) {
    combined.forEach((part, index) => {
      const partSelf = part as unknown as Record<string, unknown>;
      if (index > 0 && partSelf["has_publisher"] !== true) return;
      partSelf["publisher_prefix"] = prefix;
    });
  }
  const base = self["base"] as CsaIdentifier | undefined;
  if (base !== undefined && combined === undefined) {
    setPublisherPrefix(base, prefix);
  }
}

function parseExternalStandard(input: string): Identifier | undefined {
  if (/^(ISO\/IEC|ISO|IEC|CEI|CEI\/IEC)\s/.test(input)) {
    return tryForeign("iso", input.replace(/^CEI\/IEC/, "IEC"));
  }
  // The catalogue also prints the IWA designation without the ISO
  // keyword ("CAN/CSA-IWA 18:17" beside "CAN/CSA-ISO IWA 18:17"); the
  // ISO parser wants the ISO/ prefix.
  if (/^IWA\s/.test(input)) {
    return tryForeign("iso", input.replace(/^IWA\s/, "ISO/IWA "));
  }
  if (/^CISPR\s/.test(input)) {
    return tryForeign("iec", input);
  }
  return undefined;
}

function parseCsa(input: string): Identifier {
  if (input.startsWith("#")) {
    throw new Error(`Not a CSA identifier (comment): ${input}`);
  }
  if (/^CSA (Communities|Group|Learning|OnDemand|Update)/.test(input)) {
    throw new Error(`Not a CSA standard: ${input}`);
  }

  input = input.replaceAll("CEI/IEC", "IEC").replaceAll(/\bCEI\b/g, "IEC");

  // CAN/ wrapper (Canadian adoption).
  if (input.startsWith("CAN/")) {
    const wrappedInput0 = input.replace(/^CAN\//, "");
    if (wrappedInput0.includes("+")
      || (wrappedInput0.includes("/") && /\s+CSA-/.test(wrappedInput0))
      || (wrappedInput0.includes("/") && (wrappedInput0.match(/CSA-/g) ?? []).length > 1)) {
      let normalized = wrappedInput0.replace(/^CSA-/, "CSA ");
      normalized = normalized.replaceAll("CAN/CSA-", "CSA ").replaceAll("CAN3-", "CSA ");
      normalized = normalized.replaceAll(/\s+/g, " ").trim();
      const result = buildTree(parseTree(normalized));
      setPublisherPrefix(result as CsaIdentifier, "CAN/CSA-");
      const rMatch = /\(R(\d{4})\)/.exec(wrappedInput0);
      if (rMatch !== null) {
        (result as unknown as Record<string, unknown>)["reaffirmation"] = rMatch[1];
      }
      return result;
    }

    const { year: reaffirmYear, was4digit, rest: stripped } = extractReaffirmation(wrappedInput0);
    const originalPrefix = stripped.startsWith("CSA-")
      ? "CSA-"
      : stripped.startsWith("CSA ")
        ? "CSA"
        : undefined;
    const normalized = stripped.replace(/^CSA-/, "CSA ");
    const base = parseCsa(normalized);
    const baseSelf = base as unknown as Record<string, unknown>;
    // Only the single-document types and CsaAdopted declare
    // publisher_prefix; the containers (Combined/Bundled/Package) keep
    // what the recursive parse already injected.
    if (base instanceof CsaSingleIdentifier || base instanceof (CsaAdoptedClass as unknown as Function)) {
      if (base instanceof (SeriesClass as unknown as Function)) {
        baseSelf["publisher_prefix"] = "CAN/CSA-";
      } else if (originalPrefix !== undefined) {
        baseSelf["publisher_prefix"] = originalPrefix;
      }
    }
    if (reaffirmYear !== undefined) {
      baseSelf["reaffirmation"] = reaffirmYear;
      baseSelf["original_reaffirmation_4digit"] = was4digit;
    }
    return new (ctor(CanadianAdoptedClass))({
      base,
      ...(reaffirmYear !== undefined ? { reaffirmation: reaffirmYear } : {}),
    }) as unknown as Identifier;
  }

  // CAN3- wrapper (historical).
  if (input.startsWith("CAN3-")) {
    const wrapped0 = input.replace(/^CAN3-/, "CSA ");
    const hasDashYear = /-\d{2}\b/.test(wrapped0);
    const { year: reaffirmYear, was4digit, rest: stripped } = extractReaffirmation(wrapped0);
    const base = parseCsa(stripped);
    const baseSelf = base as unknown as Record<string, unknown>;
    if (hasDashYear) {
      baseSelf["year_format"] = "dash";
      baseSelf["original_year_4digit"] = false;
    }
    if (base instanceof (SeriesClass as unknown as Function)) {
      baseSelf["publisher_prefix"] = "CAN3-";
      if (reaffirmYear !== undefined) {
        baseSelf["reaffirmation"] = reaffirmYear;
        baseSelf["original_reaffirmation_4digit"] = was4digit;
      }
      return base;
    }
    baseSelf["publisher_prefix"] = "CAN3-";
    if (reaffirmYear !== undefined) {
      baseSelf["reaffirmation"] = reaffirmYear;
      baseSelf["original_reaffirmation_4digit"] = was4digit;
    }
    return new (ctor(CanadianAdoptedClass))({
      base,
      ...(reaffirmYear !== undefined ? { reaffirmation: reaffirmYear } : {}),
    }) as unknown as Identifier;
  }

  // CSA adoption of international standards. The catalogue also drops
  // the ISO keyword from the IWA designation ("CSA IWA 18:17").
  if (/^CSA (ISO\/IEC|CEI\/IEC|CISPR|IEC|CEI|ISO|IWA)\s/.test(input)) {
    let wrapped = input.replace(/^CSA\s+/, "");
    const { year: reaffirmYear, rest: stripped } = extractReaffirmation(wrapped);
    wrapped = stripped;
    const shortYear = /:(\d{2})\b/.exec(wrapped);
    if (shortYear !== null) {
      const two = shortYear[1]!;
      const full = Number(two) < 50 ? `20${two}` : `19${two}`;
      wrapped = wrapped.replace(new RegExp(`:${two}\\b`), `:${full}`);
    }
    wrapped = wrapped.replace(
      /\/A(\d+)([:/-])(\d{2,4})\b/g,
      (_m, num: string, sep: string, year: string) => {
        const full = year.length === 2
          ? (Number(year) < 50 ? `20${year}` : `19${year}`)
          : year;
        return `/Amd ${num}${sep}${full}`;
      },
    );
    const base = parseExternalStandard(wrapped);
    if (base === undefined) {
      throw new Error(`Unparseable adopted standard: ${input}`);
    }
    return new (ctor(CsaAdoptedClass))({
      base,
      ...(reaffirmYear !== undefined ? { reaffirmation: reaffirmYear } : {}),
    }) as unknown as Identifier;
  }

  // Package identifiers.
  if (/\sPACKAGE\b/i.test(input)) {
    let baseInput: string | undefined;
    let packageMaterials: string | undefined;
    let materialsAfter = true;

    const after = /\sPACKAGE\s+[A-Z]/i.exec(input);
    const yearThen = /:(\d{2,4})(\s+[^P]+)\s+PACKAGE/i.exec(input);
    if (after !== null) {
      const idx = input.search(/\s+PACKAGE\s+/i);
      baseInput = input.slice(0, idx).trim();
      packageMaterials = input.slice(input.indexOf("PACKAGE", idx) + "PACKAGE".length).trim() === ""
        ? ""
        : input.slice(idx).replace(/^\s+PACKAGE\s+/i, "").trim();
      materialsAfter = true;
    } else if (yearThen !== null) {
      const yearMatch = /:\d{2,4}/.exec(input);
      if (yearMatch !== null) {
        if (/,\s+CSA/.test(input)) {
          const combinedMatch = /^(.+?)(\s+&[^P]+)\s+PACKAGE$/i.exec(input);
          if (combinedMatch !== null) {
            baseInput = combinedMatch[1]!.trim();
            packageMaterials = `${combinedMatch[2]!.trim()} Package`;
          } else {
            baseInput = input.slice(0, yearMatch.index + yearMatch[0].length);
            packageMaterials = input.slice(yearMatch.index + yearMatch[0].length).trim();
          }
        } else {
          baseInput = input.slice(0, yearMatch.index + yearMatch[0].length).trim();
          packageMaterials = input.slice(yearMatch.index + yearMatch[0].length).trim();
        }
        materialsAfter = false;
      }
    } else {
      const trailing = /^(.+?)\s+PACKAGE\s*$/i.exec(input);
      if (trailing !== null) {
        baseInput = trailing[1]!.trim();
        packageMaterials = "";
        materialsAfter = true;
      }
    }

    if (baseInput === undefined || baseInput === "") {
      // Fallback: parse incrementally.
      const tokens = input.split(/\s+/);
      let acc = "";
      for (const token of tokens) {
        if (/^PACKAGE$/i.test(token)) break;
        const testInput = acc === "" ? token : `${acc} ${token}`;
        if (tryParse(testInput) === undefined) break;
        acc = testInput;
      }
      baseInput = acc;
      if (baseInput !== "" && baseInput.length < input.length) {
        const materialsInput = input.slice(baseInput.length).trim();
        packageMaterials = materialsInput.replace(/\s+PACKAGE\s*$/i, "").trim();
        materialsAfter = packageMaterials !== "";
      }
    }

    if (baseInput === undefined || baseInput === "") {
      throw new Error(`Unparseable package base: ${input}`);
    }

    const base = parseCsa(baseInput);
    return new (ctor(PackageClass))({
      base,
      package_keyword: "PACKAGE",
      ...(packageMaterials !== undefined && packageMaterials !== ""
        ? { package_materials: packageMaterials }
        : {}),
      materials_after_keyword: materialsAfter,
    }) as unknown as Identifier;
  }

  // Plain path with parser-level normalization and prefix injection.
  const hasDashYear = /-\d{2}\b/.test(input);
  const result = buildTree(parseTree(input));
  const self = result as unknown as Record<string, unknown>;
  if (hasDashYear && self["year_format"] === undefined) {
    self["year_format"] = "dash";
  }
  return result;
}

export function csaGrammarImplementation(): FlavorImplementation {
  return {
    parse(input: string): Identifier {
      return parseCsa(input);
    },
  };
}
