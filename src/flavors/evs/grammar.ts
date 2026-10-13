import { Grammar, P, match, ref, str } from "../../grammar/engine.js";
import { cenCenelecGrammar } from "../cen_cenelec/grammar.js";

/**
 * Port of the EVS grammar (evs.parg v0.3.0): the national prefix
 * ("EVS" / "prEVS") over a CEN/CENELEC adoption, a direct ISO/IEC
 * adoption, or a plain Estonian standard — plus the EVS-list
 * supplements (the national annex, the COR/AC corrigendum, the AMD
 * amendment spelling) with their semantic separators. The trailing
 * language code extracts in the parse wrapper (the CEN adopted spine
 * is greedy over plain text and would swallow it).
 */

function buildRules(): Record<string, P> {
  const rules: Record<string, P> = {};
  const rule = (name: string, build: () => P) => {
    rules[name] = build();
  };
  const digit = match("[0-9]");
  const digits = digit.repeat(1, Infinity);
  const year4 = digit.repeat(4, 4);
  const space = str(" ");
  const plus = str("+");
  const slash = str("/");
  const colon = str(":");

  // " AMD1:2014" / "+AMD1" — the AMD amendment spelling
  rule("evs_amd", () =>
    (
      (plus.or(slash).or(space)).as("amd_separator")
        .then(str("AMD").as("amd_kind"))
        .then(digits.as("amd_number"))
        .then(colon.then(year4.as("amd_year")).maybe())
    ).as("evs_amd"),
  );

  // "+COR:2015" / "/COR" — the COR spelling (the CEN spine consumes +AC)
  rule("evs_cor", () =>
    (
      (plus.or(slash)).as("cor_separator")
        .then(str("COR").as("cor_kind"))
        .then(digits.as("cor_number").maybe())
        .then(colon.then(year4.as("cor_year")).maybe())
    ).as("evs_cor"),
  );

  // " AC:2015" — the space-separated AC spelling
  rule("evs_ac", () =>
    (
      space.as("cor_separator")
        .then(str("AC").as("cor_kind"))
        .then(digits.as("cor_number").maybe())
        .then(colon.then(year4.as("cor_year")).maybe())
    ).as("evs_cor"),
  );

  // "+NA:2010" / "/NA" — the national annex
  rule("evs_na", () =>
    (
      (plus.or(slash)).as("na_separator")
        .then(str("NA"))
        .then(colon.then(year4.as("na_year")).maybe())
    ).as("na"),
  );

  // "EVS-ISO 9001:2015", "EVS-IEC 62368-1:2020"
  rule("evs_intl", () =>
    (
      (str("ISO").or(str("IEC"))).as("intl_org")
        .then(space)
        .then(digits.as("number"))
        .then((dash.then(digits.as("part"))).maybe())
        .then((colon.then(year4.as("year"))).maybe())
    ).as("intl"),
  );

  // "EVS 921:2019", "EVS-TS 1:2019", "EVS-TR 1:2019"
  rule("evs_plain", () =>
    (
      ((str("TS").or(str("TR"))).as("evs_type").then(space)).maybe()
        .then(digits.as("number"))
        .then((colon.then(year4.as("year"))).maybe())
    ).as("plain"),
  );

  rule("root", () =>
    str("pr").as("draft_prefix").maybe()
      .then(str("EVS"))
      .then(str("-").or(str(" ")).as("evs_separator"))
      .then(
        (ref(cenCenelecGrammar.rules, "identifier").as("adopted"))
          .or(ref(rules, "evs_intl"))
          .or(ref(rules, "evs_plain")),
      )
      .then(ref(rules, "evs_amd").maybe())
      .then(ref(rules, "evs_cor").or(ref(rules, "evs_ac")).maybe())
      .then(ref(rules, "evs_na").maybe()),
  );

  return rules;
}

const dash = str("-");

export const evsGrammar: Grammar = {
  rules: buildRules(),
  root: "root",
};
