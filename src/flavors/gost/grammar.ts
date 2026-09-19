import { Grammar, P, match, ref, str } from "../../grammar/engine.js";

/**
 * Port of lib/pubid/gost/parser.rb — 1:1. Root: identifier.
 *
 * Captures: gost_word, scope_r (R/Р), prefix_text (copublisher/subtype
 * as a raw string, split by the builder), raw (number+year digit runs),
 * adopted_raw (the foreign id after "/"), adopted_reference_raw (the
 * parenthesized harmonization list).
 */

function buildRules(): Record<string, P> {
  const rules: Record<string, P> = {};
  const rule = (name: string, build: () => P) => {
    rules[name] = build();
  };
  const space = str(" ");

  rule("dot", () => str("."));

  rule("year_sep", () =>
    str("-").or(str("—")).or(str("–")).then(space.maybe()),
  );

  rule("gost_word", () =>
    str("GOST").or(str("ГОСТ")).as("gost_word").then(space),
  );

  rule("scope_r", () =>
    match("R").or(match("Р")).as("scope_r").then(space),
  );

  rule("prefix_text", () =>
    match("[A-ZА-Яa-zа-я/]")
      .repeat(1, Infinity)
      .then(
        space.then(match("[A-ZА-Яa-zа-я/]").repeat(1, Infinity)).repeat(0, Infinity),
      )
      .as("prefix_text")
      .then(space),
  );

  rule("digits", () => match("[0-9]").repeat(1, Infinity));

  rule("raw_body", () =>
    ref(rules, "digits")
      .then(ref(rules, "dot").or(ref(rules, "year_sep")).then(ref(rules, "digits")).repeat(0, Infinity))
      .as("raw"),
  );

  rule("adopted_part", () =>
    space.maybe().then(str("/")).then(match(".").repeat(1, Infinity).as("adopted_raw")),
  );

  rule("adopted_reference_part", () =>
    space
      .maybe()
      .then(str("("))
      .then(match("[^)]").repeat(1, Infinity).as("adopted_reference_raw"))
      .then(str(")")),
  );

  rule("identifier", () =>
    ref(rules, "gost_word")
      .then(ref(rules, "scope_r").maybe())
      .then(ref(rules, "prefix_text").maybe())
      .then(ref(rules, "raw_body"))
      .then(ref(rules, "adopted_part").maybe())
      .then(ref(rules, "adopted_reference_part").maybe()),
  );

  return rules;
}

export const gostGrammar: Grammar = {
  rules: buildRules(),
  root: "identifier",
};
