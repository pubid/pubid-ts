import type { Tree, TreeObject } from "../../grammar/engine.js";
import { parseGrammar } from "../../grammar/engine.js";
import type { FlavorImplementation, Identifier } from "../../conformance/implementation.js";
import { asmeGrammar } from "./grammar.js";
import { AsmeIdentifier } from "./model.js";

/**
 * Port of lib/pubid/asme/builder.rb — joint publishers, BPVC code
 * assembly, and the flat attribute assignments.
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

function buildCode(parsed: Record<string, unknown>): string {
  const designator = parsed["designator"];
  if (isObj(designator)) {
    const bpvc = designator["bpvc_code"];
    if (isObj(bpvc)) {
      if (bpvc["special"] !== undefined) return "BPVC COMPLETE CODE BIND";

      const subdivision = isObj(bpvc["subdivision"]) ? (bpvc["subdivision"] as Record<string, unknown>) : undefined;
      if (subdivision !== undefined && subdivision["ssc_code"] !== undefined) {
        // BPVC.SSC.XI.II.V.IX pattern. The sections sit under
        // `ssc_code`; a bare "BPVC.SSC." parses with no inner capture,
        // so `ssc_code` is the matched string.
        const sscCode = subdivision["ssc_code"];
        const sections = isObj(sscCode) ? (sscCode as Record<string, unknown>)["ssc_sections"] : undefined;
        const sectionsStr = Array.isArray(sections)
          ? sections.flat(10).map(String).join(".")
          : String(sections ?? "");
        return sectionsStr === "" ? "BPVC.SSC." : `BPVC.SSC.${sectionsStr}`;
      }
      if (subdivision !== undefined && subdivision["case_code"] !== undefined) {
        const cc = strv(subdivision["case_code"]) ?? "";
        const caseSub = strv(subdivision["case_sub"]);
        return caseSub !== undefined && caseSub !== ""
          ? `BPVC.CC.${cc}.${caseSub}`
          : `BPVC.CC.${cc}`;
      }
      if (bpvc["case_code"] !== undefined) {
        return `BPVC-CC-${strv(bpvc["case_code"])}`;
      }
      if (subdivision !== undefined) {
        const parts = [strv(subdivision["section"]), strv(subdivision["subsection"]), strv(subdivision["sub_subsection"])]
          .filter((p): p is string => p !== undefined && p !== "");
        const langSuffix = strv(subdivision["lang_suffix"]);
        let result = `BPVC.${parts.join(".")}`;
        if (langSuffix !== undefined) result += `_${langSuffix}`;
        return result;
      }
      return "BPVC";
    }
  }

  let designatorStr = isObj(designator) ? strv(designator["designator"]) : strv(designator);
  designatorStr ??= "";
  // Normalize "V V" to "V&V".
  if (designatorStr === "V V") designatorStr = "V&V";
  const number = strv(parsed["number"]) ?? "";
  return `${designatorStr}${number}`;
}

export function buildAsmeIdentifier(tree: Tree): Identifier {
  const parsed = flatten(tree) as Record<string, unknown>;
  const self: Record<string, unknown> = {};

  if (parsed["joint_publisher"] !== undefined) {
    const joint = strv(parsed["joint_publisher"])!;
    self["joint_publisher"] = joint;
    self["publisher"] = joint;
  } else if (parsed["first_publisher"] !== undefined) {
    self["first_publisher"] = strv(parsed["first_publisher"]);
    self["first_code"] = strv(parsed["first_code"]);
    self["second_publisher"] = strv(parsed["second_publisher"]);
    self["publisher"] = `${strv(parsed["first_publisher"])}/${strv(parsed["second_publisher"])}`;
  } else {
    self["publisher"] = "ASME";
  }

  if (parsed["designator"] !== undefined) {
    self["number"] = buildCode(parsed);
  } else if (parsed["number"] !== undefined) {
    self["number"] = strv(parsed["number"]);
  }

  if (parsed["ptc_suffix"] !== undefined) self["ptc_suffix"] = strv(parsed["ptc_suffix"]);
  if (parsed["year"] !== undefined) self["year"] = strv(parsed["year"]);
  if (parsed["draft_year"] !== undefined) self["draft_year"] = strv(parsed["draft_year"]);
  if (parsed["reaffirmation"] !== undefined) {
    const raw = parsed["reaffirmation"];
    const reaffirmation = isObj(raw) ? strv((raw as Record<string, unknown>)["year"]) : strv(raw);
    self["reaffirmation"] = `R${reaffirmation}`;
  }
  if (parsed["language"] !== undefined) {
    self["language"] = strv(parsed["language"]);
  } else if (parsed["lang_suffix"] !== undefined) {
    self["language"] = strv(parsed["lang_suffix"]);
  }
  if (parsed["csa_number"] !== undefined) self["csa_number"] = strv(parsed["csa_number"]);
  if (parsed["handbook"] !== undefined) self["handbook"] = true;
  if (parsed["revision_note"] !== undefined) {
    self["revision_note"] = `[${strv(parsed["revision_note"])}]`;
  }
  if (parsed["ref_standard"] !== undefined) {
    const ref = strv(parsed["ref_standard"]) ?? "";
    const m = /^(Proposed revision|Revision) of (.+)$/.exec(ref);
    if (m !== null) {
      self["parenthetical_revision"] = `(${m[1]} of ${m[2]})`;
    } else {
      self["parenthetical_revision"] = `(Revision of ${ref})`;
    }
  }

  return new AsmeIdentifier(self) as unknown as Identifier;
}

export function asmeGrammarImplementation(): FlavorImplementation {
  return {
    parse(input: string): Identifier {
      const tree = parseGrammar(asmeGrammar, input);
      return buildAsmeIdentifier(tree);
    },
  };
}
