import { BaseIdentifier, registerType } from "../../model/identifier.js";
import type { IdentifierStatic } from "../../model/identifier.js";
import { extendAttributes, keyValue, type AttributeTable, type FieldMapping } from "../../model/attribute.js";
import { BaseUrnGenerator } from "../../model/urn-generator.js";

/**
 * Port of lib/pubid/astm: the CodeNumber split columns (letter/number/
 * suffix/subseries/dual_m) on every concrete class, the renderer family
 * and the URN generator. Adjunct stores its designation directly in
 * `number`.
 */

export class AstmCode {
  readonly letter: string | undefined;
  readonly number: string | undefined;
  readonly suffix: string | undefined;
  readonly subseries: string | undefined;
  readonly dualM: boolean;

  constructor(attrs: Record<string, unknown>) {
    this.letter = attrs["letter"] as string | undefined;
    this.number = attrs["number"] as string | undefined;
    this.suffix = attrs["suffix"] as string | undefined;
    this.subseries = attrs["subseries"] as string | undefined;
    this.dualM = attrs["dual_m"] === true;
  }

  render(): string {
    if (this.letter !== undefined) {
      let result = [this.letter, this.number, this.suffix]
        .filter((s) => s !== undefined)
        .join("");
      if (this.subseries !== undefined) result += `-S${this.subseries}`;
      if (this.dualM) result += "M";
      return result;
    }
    let result = this.number ?? "";
    if (this.suffix !== undefined) result += this.suffix;
    if (this.subseries !== undefined) result += `-S${this.subseries}`;
    return result;
  }
}

const CODE_COLUMN_DEFS: AttributeTable = {
  number: { type: "string" },
  letter: { type: "string" },
  suffix: { type: "string" },
  subseries: { type: "string" },
  dual_m: { type: "boolean", default: false },
};
const CODE_COLUMN_MAPPINGS = keyValue(
  { wire: "number", to: "number" },
  { wire: "letter", to: "letter" },
  { wire: "suffix", to: "suffix" },
  { wire: "subseries", to: "subseries" },
  { wire: "dual_m", to: "dual_m" },
);

export abstract class AstmIdentifier extends BaseIdentifier {
  static attributes = extendAttributes(BaseIdentifier, {
    ...CODE_COLUMN_DEFS,
    publisher: { type: "string", default: "ASTM" },
    year: { type: "string" },
    format_suffix: { type: "string" },
    type: { type: "string" },
  });
  static mappings: FieldMapping[] = keyValue(
    ...CODE_COLUMN_MAPPINGS,
    { wire: "publisher", to: "publisher" },
    { wire: "year", to: "year" },
    { wire: "format_suffix", to: "format_suffix" },
    { wire: "type", to: "type" },
  );

  declare readonly number: string | undefined;
  declare readonly letter: string | undefined;
  declare readonly suffix: string | undefined;
  declare readonly subseries: string | undefined;
  declare readonly dual_m: boolean | undefined;
  declare readonly publisher: string;
  declare readonly year: string | undefined;
  declare readonly format_suffix: string | undefined;
  declare readonly type: string | undefined;

  code(): AstmCode | undefined {
    if (this.number === undefined && this.letter === undefined) return undefined;
    return new AstmCode({
      letter: this.letter,
      number: this.number,
      suffix: this.suffix,
      subseries: this.subseries,
      dual_m: this.dual_m,
    });
  }

  toUrn(): string {
    return new AstmUrnGenerator(this).generate();
  }
}

function yearPortion(year: string): string {
  return year.length === 4 ? year.slice(-2) : year;
}

// --- Renderer -------------------------------------------------------------------

function renderStandard(id: AstmIdentifier): string {
  const parts: string[] = [];
  parts.push(id.publisher);
  const code = id.code();
  if (code !== undefined) {
    let codeStr = code.render();
    if (code.dualM) {
      const baseCode = `${code.letter ?? ""}${code.number ?? ""}`;
      codeStr = `${baseCode}/${baseCode}M`;
    }
    parts.push(codeStr);
  }
  let result = parts.join(" ");
  const self = id as unknown as Record<string, unknown>;
  if (id.year !== undefined) {
    result += `-${yearPortion(id.year)}`;
    if (self["sub_year"] !== undefined) result += self["sub_year"];
  }
  if (self["reapproval"] !== undefined) result += `(${self["reapproval"]})`;
  if (self["edition"] !== undefined) result += `e${self["edition"]}`;
  return result;
}

// --- URN generator ---------------------------------------------------------------

class AstmUrnGenerator extends BaseUrnGenerator<AstmIdentifier> {
  generate(): string {
    const id = this.identifier;
    const self = id as unknown as Record<string, unknown>;
    // Ruby: ["urn", ns, type_segment?, code, ...] with the publisher
    // replacing the namespace slot ("iso/astm" for ISO/ASTMTR).
    const parts = ["urn", id.publisher.toLowerCase(), "std"];
    const code = id.code();
    if (code !== undefined) parts.push(code.render());
    if (id.year !== undefined) parts.push(yearPortion(id.year));
    if (self["sub_year"] !== undefined) parts.push(String(self["sub_year"]));
    if (self["reapproval"] !== undefined) parts.push(`reapp.${self["reapproval"]}`);
    if (self["edition"] !== undefined) parts.push(`e${self["edition"]}`);
    return parts.join(":");
  }
}

// --- Class family ----------------------------------------------------------------

interface ClassSpec {
  kind: string;
  extraDefs?: AttributeTable;
  render: (id: AstmIdentifier) => string;
  urn?: (id: AstmIdentifier) => string;
}

function astmClass(spec: ClassSpec): IdentifierStatic {
  class AstmConcrete extends AstmIdentifier {
    static polymorphicName = `pubid:astm:${spec.kind}`;
    static urnGenerator = AstmUrnGenerator;
    static get attributes() {
      return spec.extraDefs === undefined
        ? AstmIdentifier.attributes
        : extendAttributes(AstmIdentifier, spec.extraDefs);
    }
    static get mappings() {
      return spec.extraDefs === undefined
        ? [...AstmIdentifier.mappings]
        : [...AstmIdentifier.mappings,
            ...Object.keys(spec.extraDefs).map((name) => ({ wire: name, to: name } as FieldMapping))];
    }

    render(): string {
      return spec.render(this);
    }

    toUrn(): string {
      return spec.urn !== undefined ? spec.urn(this) : super.toUrn();
    }
  }
  registerType(AstmConcrete as unknown as IdentifierStatic);
  return AstmConcrete as unknown as IdentifierStatic;
}

export const StandardClass = astmClass({
  kind: "standard",
  extraDefs: {
    sub_year: { type: "string" },
    reapproval: { type: "string" },
    edition: { type: "string" },
  },
  render: renderStandard,
});

export const IsoDualPublishedClass = astmClass({
  kind: "iso-dual-published",
  extraDefs: {
    sub_year: { type: "string" },
    reapproval: { type: "string" },
    edition: { type: "string" },
  },
  render: renderStandard,
});

export const ResearchReportClass = astmClass({
  kind: "research-report",
  extraDefs: { committee: { type: "string" } },
  render: (id) => [id.publisher, `RR:${(id as unknown as Record<string, unknown>)["committee"]}-${id.code()?.number}`].join(" "),
});

export const DataSeriesClass = astmClass({
  kind: "data-series",
  extraDefs: { hol_suffix: { type: "boolean" } },
  render: (id) => {
    const self = id as unknown as Record<string, unknown>;
    let result = `${id.publisher} DS`;
    result += id.code()?.render() ?? "";
    if (self["hol_suffix"] === true) result += "HOL";
    if (id.format_suffix !== undefined) result += id.format_suffix;
    return result;
  },
});

export const TechnicalReportClass = astmClass({
  kind: "technical-report",
  render: (id) => {
    let result: string;
    const code = id.code();
    if (id.publisher === "ISO/ASTM" && (code === undefined || code.letter === undefined)) {
      result = "ISO/ASTMTR";
    } else {
      result = "TR";
      if (code?.letter !== undefined) result += code.letter;
    }
    if (code?.number !== undefined) result += code.number;
    if (id.format_suffix !== undefined) result += id.format_suffix;
    return result;
  },
});

export const MonographClass = astmClass({
  kind: "monograph",
  extraDefs: { edition: { type: "string" } },
  render: (id) => {
    const self = id as unknown as Record<string, unknown>;
    let result = `${id.publisher} MONO`;
    result += id.code()?.number ?? "";
    if (self["edition"] !== undefined) result += `-${self["edition"]}`;
    if (id.format_suffix !== undefined) result += id.format_suffix;
    return result;
  },
});

export const AdjunctClass = astmClass({
  kind: "adjunct",
  extraDefs: {
    ea_suffix: { type: "boolean" },
    dvd_suffix: { type: "boolean" },
  },
  render: (id) => {
    const self = id as unknown as Record<string, unknown>;
    const result: string[] = [];
    if (self["ea_suffix"] !== true && self["dvd_suffix"] !== true) {
      result.push(id.publisher);
    }
    result.push(
      `ADJ${id.number ?? ""}${self["ea_suffix"] === true ? "-EA" : ""}${self["dvd_suffix"] === true ? "DVD" : ""}`,
    );
    return result.join(" ");
  },
});

export const WorkInProgressClass = astmClass({
  kind: "work-in-progress",
  render: (id) => `${id.publisher} WK${id.code()?.number ?? ""}`,
});

export const ManualClass = astmClass({
  kind: "manual",
  extraDefs: {
    edition: { type: "string" },
    supplement: { type: "boolean" },
    tp_designation: { type: "string" },
  },
  render: (id) => {
    const self = id as unknown as Record<string, unknown>;
    let result = "MNL";
    if (self["tp_designation"] !== undefined) result += "TP";
    result += id.code()?.number ?? "";
    if (self["edition"] !== undefined) result += `-${self["edition"]}`;
    result = `${id.publisher} ${result}`;
    if (self["supplement"] === true) result += "-SUP";
    if (id.format_suffix !== undefined) result += id.format_suffix;
    return result;
  },
});
