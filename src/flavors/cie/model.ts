import { BaseIdentifier, registerType } from "../../model/identifier.js";
import type { IdentifierStatic } from "../../model/identifier.js";
import { extendAttributes } from "../../model/attribute.js";
import { Component } from "../../model/component.js";
import { BaseUrnGenerator } from "../../model/urn-generator.js";

/**
 * Port of lib/pubid/cie/identifiers/* + components/language.rb.
 * The wire hash is the raw attribute table (CIE declares no key_value
 * block): number/part/iteration/part_separator flat, `language` a
 * nested {code, format[, translation_year]} hash, publisher ("CIE")
 * and style ("current") dropped as defaults.
 */

/** The CIE Language component: four printed formats. */
export class CieLanguage extends Component {
  readonly code?: string | undefined;
  readonly format?: string | undefined;
  readonly translation_year?: string | undefined;

  constructor(attrs: Record<string, unknown>) {
    super();
    this.code = attrs["code"] as string | undefined;
    this.format = attrs["format"] as string | undefined;
    this.translation_year = attrs["translation_year"] as string | undefined;
  }

  render(): string {
    switch (this.format) {
      case "slash":
      case "slash_colon":
        return `/${this.code ?? ""}`;
      case "paren_year":
        return ` (${this.code}-${this.translation_year})`;
      default:
        return `(${this.code ?? ""})`;
    }
  }

  toWire(): Record<string, unknown> {
    return {
      code: this.code,
      format: this.format,
      ...(this.translation_year !== undefined ? { translation_year: this.translation_year } : {}),
    };
  }
}

export abstract class CieIdentifier extends BaseIdentifier {
  static attributes = extendAttributes(BaseIdentifier, {
    style: { type: "string", default: "current" },
  });

  declare readonly style: string | undefined;

  constructor(attrs: Record<string, unknown> = {}) {
    super(attrs);
    // Materialize the default the way lutaml does (runtime readers see
    // "current" for an undated identifier; toHash still drops it).
    if ((this as Record<string, unknown>)["style"] === undefined) {
      (this as Record<string, unknown>)["style"] = "current";
    }
  }

  dateSepChar(): string {
    if (this.style === "legacy") return "-";
    if (this.style === "slash") return "/";
    return ":";
  }

  codeString(): string | undefined {
    const self = this as unknown as Record<string, unknown>;
    const number = self["number"] as string | undefined;
    if (number === undefined) return undefined;
    const part = self["part"] as string | undefined;
    const iteration = self["iteration"] as string | undefined;
    const partSeparator = self["part_separator"] as string | undefined;
    let result = number;
    if (part !== undefined && iteration !== undefined) {
      result += `/${part}.${iteration}`;
    } else if (iteration !== undefined) {
      result += `.${iteration}`;
    } else if (part !== undefined) {
      const separator =
        partSeparator === "slash" ? "/" : partSeparator === "dash" ? "-" : this.style === "current" ? "-" : "/";
      result += `${separator}${part}`;
    }
    return result;
  }
}

export abstract class CieSingleIdentifier extends CieIdentifier {
  static attributes = extendAttributes(CieIdentifier, {
    publisher: { type: "string", default: "CIE" },
    year: { type: "string" },
  });

  declare readonly year: string | undefined;
}

const CODE_ATTRS = {
  number: { type: "string" },
  part: { type: "string" },
  iteration: { type: "string" },
  part_separator: { type: "string" },
} as const;

// ---------------------------------------------------------------------------
// URN generation (lib/pubid/cie/urn_generator.rb).
// ---------------------------------------------------------------------------

export class CieUrnGenerator extends BaseUrnGenerator<CieIdentifier> {
  generate(): string {
    const id = this.identifier;
    const parts = ["urn", "cie"];

    const special = this.specialIdentifierTypeComponent();
    if (special !== undefined) parts.push(special);

    if (this.maybeAttr("s_prefix") === true) parts.push("s");

    parts.push(this.publisherComponent());

    // Only the CodeAttributes classes carry a code_string (Conference,
    // Proceedings, Bundle and the supplements deliberately do not).
    if (
      id instanceof CieStandard ||
      id instanceof CieJointPublished ||
      id instanceof CieDualPublished ||
      id instanceof CieIdentical
    ) {
      const codeString = id.codeString();
      if (codeString !== undefined) parts.push(codeString);
    }

    const year = this.maybeAttr("year");
    if (year !== undefined) parts.push(String(year));

    const language = this.maybeAttr("language");
    if (language instanceof CieLanguage) {
      if (language.code !== undefined) {
        parts.push(language.code.toLowerCase());
        if (language.format !== undefined) parts.push(language.format.toLowerCase());
      } else {
        parts.push(language.render().toLowerCase());
      }
    }

    const stage = this.maybeAttr("stage");
    if (stage !== undefined) parts.push(String(stage).toLowerCase());

    // style is the sole separator field; record it for dated identifiers.
    if (year !== undefined) parts.push(`sep.${this.maybeAttr("style")}`);

    const iecIdentifier = this.maybeAttr("iec_identifier");
    if (iecIdentifier !== undefined) parts.push(`iec.${String(iecIdentifier)}`);

    const isoReference = this.maybeAttr("iso_reference");
    if (isoReference !== undefined) parts.push(`iso.${String(isoReference)}`);

    const docType = this.maybeAttr("doc_type");
    if (docType !== undefined) parts.push(`doctype.${String(docType)}`);

    const ids = this.maybeAttr("ids");
    if (Array.isArray(ids) && ids.length > 0) {
      parts.push(`bundle.${(id as unknown as { toHuman(): string }).toHuman()}`);
    }

    if (id instanceof CieTutorialBundle && (id as CieTutorialBundle).number !== undefined) {
      parts.push(`tut-bundle.${(id as CieTutorialBundle).number}`);
    }

    return parts.join(":");
  }

  /** Base#maybe: reads a DECLARED attribute only. */
  private maybeAttr(name: string): unknown {
    const attributes = this.identifier.constructor.attributes;
    if (attributes === undefined || !(name in attributes)) return undefined;
    return (this.identifier as unknown as Record<string, unknown>)[name];
  }

  private specialIdentifierTypeComponent(): string | undefined {
    const name = this.identifier.constructor.polymorphicName;
    // Mirrors the Ruby class-name regex order: /Bundle$/ also claims
    // TutorialBundle, so the /TutorialBundle/ arm is unreachable.
    if (name.endsWith("dual-published")) return "dual-pub";
    if (name.endsWith("identical")) return "identical";
    if (name.endsWith("joint-published")) return "joint-pub";
    if (name.endsWith("bundle")) return "bundle";
    return undefined;
  }

  private publisherComponent(): string {
    let pub = "cie";
    const publisher = this.maybeAttr("publisher");
    if (publisher !== undefined) pub = String(publisher).toLowerCase();
    const copublisher = this.maybeAttr("copublisher");
    if (copublisher !== undefined) {
      pub = `${pub}-${String(copublisher).toLowerCase()}`;
    } else {
      const copubs = this.maybeAttr("copublishers");
      if (Array.isArray(copubs) && copubs.length > 0) {
        pub = `${pub}-${copubs.join("-").toLowerCase()}`;
      }
    }
    return pub;
  }
}

function attachUrn(klass: object): void {
  (klass as unknown as Record<string, unknown>)["urnGenerator"] = CieUrnGenerator;
}

// ---------------------------------------------------------------------------
// The concrete classes.
// ---------------------------------------------------------------------------

export class CieStandard extends CieSingleIdentifier {
  static polymorphicName = "pubid:cie:standard";
  static attributes = extendAttributes(CieSingleIdentifier, {
    ...CODE_ATTRS,
    s_prefix: { type: "boolean", default: false },
    d_prefix: { type: "boolean", default: false },
    language: { type: CieLanguage },
    stage: { type: "string" },
  });

  declare readonly s_prefix: boolean | undefined;
  declare readonly d_prefix: boolean | undefined;
  declare readonly language: CieLanguage | undefined;
  declare readonly stage: string | undefined;
  declare readonly number: string | undefined;

  render(): string {
    const parts = ["CIE"];
    if (this.stage !== undefined) parts.push(this.stage);
    if (this.d_prefix === true) {
      parts.push(`D${this.codeString() ?? ""}`);
    } else {
      if (this.s_prefix === true) parts.push("S");
      if (this.number !== undefined) parts.push(this.codeString() ?? "");
    }
    let result = parts.join(" ");
    if (this.language?.format === "slash") {
      result += `/${this.language.code}`;
    }
    if (this.language?.format === "slash_colon") {
      return result + `/${this.language.code}:${this.year}`;
    }
    if (this.year !== undefined && this.style === "slash") {
      return result + `/${this.year}`;
    }
    if (this.year !== undefined) {
      result += `${this.dateSepChar()}${this.year}`;
    }
    if (
      this.language !== undefined &&
      this.language.format !== "slash" &&
      this.language.format !== "slash_colon"
    ) {
      result += this.language.render();
    }
    return result;
  }
}
registerType(CieStandard as unknown as IdentifierStatic);
attachUrn(CieStandard);

export class CieJointPublished extends CieSingleIdentifier {
  static polymorphicName = "pubid:cie:joint-published";
  static attributes = extendAttributes(CieSingleIdentifier, {
    ...CODE_ATTRS,
    copublisher: { type: "string" },
    language: { type: CieLanguage },
    doc_type: { type: "string" },
    stage: { type: "string" },
  });

  declare readonly copublisher: string | undefined;
  declare readonly language: CieLanguage | undefined;
  declare readonly doc_type: string | undefined;
  declare readonly stage: string | undefined;
  declare readonly number: string | undefined;
  declare readonly part: string | undefined;

  render(): string {
    const parts = ["CIE", this.copublisher ?? ""];
    if (this.doc_type !== undefined) parts.push(this.doc_type);
    if (this.stage !== undefined) parts.push(this.stage);
    if (this.number !== undefined) {
      let codeStr = this.codeString() ?? "";
      if (this.copublisher === "IEC" && this.part !== undefined) {
        codeStr = `${this.number}.${this.part}`;
      }
      parts.push(codeStr);
    }
    let result = parts.join(" ");
    if (this.year !== undefined) result += `${this.dateSepChar()}${this.year}`;
    if (this.language !== undefined) result += this.language.render();
    return result;
  }
}
registerType(CieJointPublished as unknown as IdentifierStatic);
attachUrn(CieJointPublished);

export class CieDualPublished extends CieSingleIdentifier {
  static polymorphicName = "pubid:cie:dual-published";
  static attributes = extendAttributes(CieSingleIdentifier, {
    ...CODE_ATTRS,
    s_prefix: { type: "boolean", default: false },
    iec_identifier: { type: "string" },
  });

  declare readonly s_prefix: boolean | undefined;
  declare readonly iec_identifier: string | undefined;
  declare readonly number: string | undefined;

  render(): string {
    const parts = ["CIE"];
    if (this.s_prefix === true) parts.push("S");
    if (this.number !== undefined) parts.push(this.codeString() ?? "");
    let result = parts.join(" ");
    if (this.year !== undefined) result += `${this.dateSepChar()}${this.year}`;
    if (this.iec_identifier !== undefined) result += `/IEC ${this.iec_identifier}`;
    return result;
  }
}
registerType(CieDualPublished as unknown as IdentifierStatic);
attachUrn(CieDualPublished);

export class CieIdentical extends CieSingleIdentifier {
  static polymorphicName = "pubid:cie:identical";
  static attributes = extendAttributes(CieSingleIdentifier, {
    ...CODE_ATTRS,
    s_prefix: { type: "boolean", default: false },
    language: { type: CieLanguage },
    iso_reference: { type: "string" },
  });

  declare readonly s_prefix: boolean | undefined;
  declare readonly language: CieLanguage | undefined;
  declare readonly iso_reference: string | undefined;
  declare readonly number: string | undefined;

  render(): string {
    const parts = ["CIE"];
    if (this.s_prefix === true) parts.push("S");
    if (this.number !== undefined) parts.push(this.codeString() ?? "");
    let result = parts.join(" ");

    if (
      this.language !== undefined &&
      (this.language.format === "slash_colon" ||
        (this.language.format === "slash" && this.year !== undefined && this.style !== "slash"))
    ) {
      result +=
        this.language.format === "slash_colon"
          ? `/${this.language.code}:${this.year}`
          : `/${this.language.code}${this.year}`;
    } else if (this.language?.format === "slash") {
      result += `/${this.language.code}`;
    } else if (this.year !== undefined && this.style === "slash") {
      result += `/${this.year}`;
    } else if (this.year !== undefined) {
      result += `${this.dateSepChar()}${this.year}`;
    }

    if (
      this.language !== undefined &&
      this.language.format !== "slash" &&
      this.language.format !== "slash_colon"
    ) {
      result += this.language.render();
    }
    if (this.iso_reference !== undefined) result += ` (ISO ${this.iso_reference})`;
    return result;
  }
}
registerType(CieIdentical as unknown as IdentifierStatic);
attachUrn(CieIdentical);

export class CieConference extends CieSingleIdentifier {
  static polymorphicName = "pubid:cie:conference";
  static attributes = extendAttributes(CieSingleIdentifier, {
    number: { type: "string" },
    amendment_number: { type: "string" },
    variant: { type: "string" },
  });

  declare readonly number: string | undefined;
  declare readonly amendment_number: string | undefined;
  declare readonly variant: string | undefined;

  render(): string {
    let result = `CIE x${this.number ?? ""}`;
    if (this.year !== undefined) result += `${this.dateSepChar()}${this.year}`;
    if (this.amendment_number !== undefined) result += ` Amendment ${this.amendment_number}`;
    if (this.variant !== undefined) result += `/${this.variant}`;
    return result;
  }
}
registerType(CieConference as unknown as IdentifierStatic);
attachUrn(CieConference);

export class CieProceedings extends CieSingleIdentifier {
  static polymorphicName = "pubid:cie:proceedings";
  static attributes = extendAttributes(CieSingleIdentifier, {
    number: { type: "string" },
    conference: { type: "string" },
    page: { type: "string" },
  });

  declare readonly number: string | undefined;
  declare readonly conference: string | undefined;
  declare readonly page: string | undefined;

  render(): string {
    return this.conference !== undefined
      ? `CIE x${this.conference}-${this.number}`
      : `CIE ${this.number} ${this.page}`;
  }
}
registerType(CieProceedings as unknown as IdentifierStatic);
attachUrn(CieProceedings);

export class CieTutorialBundle extends CieSingleIdentifier {
  static polymorphicName = "pubid:cie:tutorial-bundle";
  static attributes = extendAttributes(CieSingleIdentifier, {
    number: { type: "string" },
  });

  declare readonly number: string | undefined;

  render(): string {
    return `CIE Tutorials Bundle ${this.number ?? ""}`;
  }
}
registerType(CieTutorialBundle as unknown as IdentifierStatic);
attachUrn(CieTutorialBundle);

// --- Supplement seam (SupplementIdentifier) ---------------------------------

export abstract class CieSupplementIdentifier extends CieIdentifier {
  static attributes = extendAttributes(CieIdentifier, {
    base: { type: CieIdentifier as unknown as IdentifierStatic },
    number: { type: "string" },
  });

  declare readonly base: CieIdentifier | undefined;
  declare readonly number: string | undefined;
}

export class CieSupplement extends CieSupplementIdentifier {
  static polymorphicName = "pubid:cie:supplement";
  static attributes = extendAttributes(CieSupplementIdentifier, {
    part: { type: "string" },
  });

  declare readonly part: string | undefined;

  render(): string {
    const b = this.base as unknown as Record<string, unknown>;
    const parts = ["CIE"];
    if (b["stage"] !== undefined && b["stage"] !== null) parts.push(String(b["stage"]));
    let core = `${b["number"] ?? ""}-SP${this.number ?? ""}`;
    if (this.part !== undefined) core += `.${this.part}`;
    parts.push(core);
    let result = parts.join(" ");
    const language = b["language"] as CieLanguage | undefined;
    if (language?.format === "slash_colon") {
      result += `/${language.code}`;
    }
    if (b["year"] !== undefined && b["year"] !== null) result += `:${String(b["year"])}`;
    return result;
  }
}
registerType(CieSupplement as unknown as IdentifierStatic);
attachUrn(CieSupplement);

export class CieCorrigendum extends CieSupplementIdentifier {
  static polymorphicName = "pubid:cie:corrigendum";
  static attributes = extendAttributes(CieSupplementIdentifier, {
    year: { type: "string" },
  });

  declare readonly year: string | undefined;

  render(): string {
    return `${this.base?.toHuman()}/Cor${this.number}:${this.year}`;
  }
}
registerType(CieCorrigendum as unknown as IdentifierStatic);
attachUrn(CieCorrigendum);

export class CieBundle extends CieSingleIdentifier {
  static polymorphicName = "pubid:cie:bundle";
  static attributes = extendAttributes(CieSingleIdentifier, {
    base: { type: CieIdentifier as unknown as IdentifierStatic },
    ids: { type: CieIdentifier as unknown as IdentifierStatic, collection: true, initializeEmpty: true },
  });

  declare readonly base: CieIdentifier | undefined;
  declare readonly ids: CieIdentifier[];

  render(): string {
    if (this.ids.length === 0) return "";
    return this.ids
      .map((id, i) => {
        const member =
          (id as unknown as Record<string, unknown>)["base"] !== undefined
            ? id
            : this.rebased(id);
        const str = member.toHuman();
        return i === 0 ? str : str.replace(/^CIE /, "");
      })
      .join(",");
  }

  private rebased(id: CieIdentifier): CieIdentifier {
    const rec = id as unknown as Record<string, unknown>;
    return new CieSupplement({
      base: this.base,
      number: rec["number"],
      part: rec["part"],
    }) as CieIdentifier;
  }
}
registerType(CieBundle as unknown as IdentifierStatic);
attachUrn(CieBundle);
