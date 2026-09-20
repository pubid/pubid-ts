import { Grammar, P, match, ref, str } from "../../grammar/engine.js";

/**
 * Port of lib/pubid/amca/parser.rb — 1:1. Root: identifier.
 *
 * Branch order: interpretation, publication, standard.
 */

function buildRules(): Record<string, P> {
  const rules: Record<string, P> = {};
  const rule = (name: string, build: () => P) => {
    rules[name] = build();
  };

  rule("space", () => str(" "));
  rule("dash", () => str("-"));
  rule("slash", () => str("/"));
  rule("lparen", () => str("("));
  rule("rparen", () => str(")"));
  rule("dot", () => str("."));
  rule("digit", () => match("[0-9]"));
  rule("digits", () => ref(rules, "digit").repeat(1, Infinity));
  rule("letter", () => match("[A-Za-z]"));

  rule("year_digits", () =>
    str("19").or(str("20")).then(ref(rules, "digit").repeat(2, 2))
      .or(ref(rules, "digit").repeat(2, 2)),
  );

  rule("copublisher", () =>
    str("ANSI").then(ref(rules, "slash")).then(str("AMCA"))
      .or(str("AMCA")),
  );

  rule("additional_copublisher", () =>
    ref(rules, "slash")
      .then(ref(rules, "letter").repeat(2, 10))
      .then(ref(rules, "space"))
      .then(ref(rules, "digits"))
      .then((ref(rules, "dash").then(ref(rules, "digits"))).maybe()),
  );

  rule("code", () =>
    (
      ref(rules, "digits")
        .then((ref(rules, "dash").then(ref(rules, "letter"))).maybe())
        .then((ref(rules, "dot").then(ref(rules, "digits"))).maybe())
    ).as("code"),
  );

  rule("type", () => str("Standard").or(str("Publication")));

  rule("reaffirmation", () =>
    ref(rules, "lparen").then(str("R")).then(ref(rules, "digits").as("reaffirmed")).then(ref(rules, "rparen")),
  );

  // Consumed but never captured (the Ruby rule has no .as).
  rule("suffix", () => str("R").or(str("P")));

  rule("revision", () =>
    ref(rules, "lparen").then(str("Rev")).then(ref(rules, "dot").maybe())
      .then(ref(rules, "space"))
      .then(
        ref(rules, "digits").then(ref(rules, "dash")).then(ref(rules, "digits")).as("revision"),
      )
      .then(ref(rules, "rparen")),
  );

  rule("interpretation_code", () =>
    ref(rules, "letter").repeat(2, Infinity).as("interpretation_code")
      .or(ref(rules, "digits").as("interpretation_code")),
  );

  rule("interp_keyword", () =>
    ref(rules, "space").then(str("Interp")),
  );

  const copubSpace = () =>
    ref(rules, "copublisher").as("copublisher").maybe().then(ref(rules, "space"));

  rule("interpretation_identifier", () =>
    (
      copubSpace()
        .then(ref(rules, "code"))
        .then(ref(rules, "space"))
        .then(
          ref(rules, "interpretation_code").then(ref(rules, "interp_keyword"))
            .or(
              str("–").or(ref(rules, "dash"))
                .then(ref(rules, "digits").as("interpretation_year"))
                .then(ref(rules, "interp_keyword").maybe()),
            ),
        )
    ).as("interpretation")
      .or(
        copubSpace()
          .then(ref(rules, "code"))
          .then(ref(rules, "interp_keyword"))
          .as("interpretation"),
      ),
  );

  rule("publication_identifier", () =>
    (
      copubSpace()
        .then(str("Publication").as("publication_keyword"))
        .then(ref(rules, "space"))
        .then(ref(rules, "code"))
        .then((ref(rules, "dash").then(ref(rules, "year_digits").as("year"))).maybe())
        .then((ref(rules, "space").then(ref(rules, "revision"))).maybe())
        .then((ref(rules, "space").then(ref(rules, "reaffirmation"))).maybe())
    ).as("publication"),
  );

  rule("standard_identifier", () =>
    (
      copubSpace()
        .then(ref(rules, "type").as("type").maybe())
        .then(ref(rules, "space").maybe())
        .then(ref(rules, "code"))
        .then((ref(rules, "dash").then(ref(rules, "year_digits").as("year"))).maybe())
        .then((ref(rules, "space").then(ref(rules, "additional_copublisher"))).maybe())
        .then(ref(rules, "suffix").maybe())
        .then((ref(rules, "space").then(ref(rules, "reaffirmation"))).maybe())
    ).as("standard"),
  );

  rule("identifier", () =>
    ref(rules, "interpretation_identifier")
      .or(ref(rules, "publication_identifier"))
      .or(ref(rules, "standard_identifier")),
  );

  return rules;
}

export const amcaGrammar: Grammar = {
  rules: buildRules(),
  root: "identifier",
};

/** Parser.parse normalization. */
export function preprocessAmca(input: string): string {
  let cleaned = input.trim();
  cleaned = cleaned.replaceAll(/\s+/g, " ");
  cleaned = cleaned.replaceAll("–", "-");
  cleaned = cleaned.replace(/[,.]$/, "");
  return cleaned;
}
