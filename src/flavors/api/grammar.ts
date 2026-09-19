import { Grammar, P, match, ref, str } from "../../grammar/engine.js";

/**
 * Port of lib/pubid/api/parser.rb — 1:1. Root: identifier.
 *
 * Branch order: combined, MPMS, typed, typeless.
 */

function buildRules(): Record<string, P> {
  const rules: Record<string, P> = {};
  const rule = (name: string, build: () => P) => {
    rules[name] = build();
  };

  rule("space", () => str(" "));
  rule("dash", () => str("-"));
  rule("slash", () => str("/"));
  rule("colon", () => str(":"));
  rule("dot", () => str("."));
  rule("digit", () => match("[0-9]"));
  rule("digits", () => ref(rules, "digit").repeat(1, Infinity));
  rule("letter", () => match("[A-Z]"));
  rule("letters", () => ref(rules, "letter").repeat(1, Infinity));

  rule("publisher", () => str("API").then(ref(rules, "space")));

  rule("doc_type", () =>
    str("MPMS").or(str("BULL")).or(str("SPEC")).or(str("STD"))
      .or(str("RP")).or(str("TR")).or(str("COS")).or(str("PUBL"))
      .as("type"),
  );

  rule("chapter_notation", () =>
    ref(rules, "space").then(str("CH")).then(ref(rules, "space"))
      .then(ref(rules, "digits").as("chapter")),
  );

  rule("number_with_part", () =>
    match("[0-9A-Z]").repeat(1, Infinity).as("number")
      .then(
        (ref(rules, "dash").then((match("[0-9A-Z]").repeat(1, Infinity)).as("part"))).maybe(),
      ),
  );

  rule("digits_with_letter", () =>
    ref(rules, "digits").then(ref(rules, "letter").maybe()),
  );

  rule("year", () => ref(rules, "digit").repeat(4, 4).as("year"));

  rule("date_dash", () => ref(rules, "dash").then(ref(rules, "year")));
  rule("date_colon", () => ref(rules, "colon").then(ref(rules, "year")));

  rule("reaffirmation", () =>
    ref(rules, "space").then(str("(R")).then(ref(rules, "year")).then(str(")")),
  );

  rule("part_notation", () =>
    str(", Part ").then(ref(rules, "digits").as("part_number")),
  );

  rule("edition_notation", () =>
    str(", ")
      .then(ref(rules, "digits").as("edition_number"))
      .then(str("st").or(str("nd")).or(str("rd")).or(str("th")))
      .then(str(" edition")),
  );

  rule("mpms_identifier", () =>
    ref(rules, "publisher")
      .then(str("MPMS").as("type"))
      .then(ref(rules, "chapter_notation"))
      .then((ref(rules, "dot").then(ref(rules, "digits_with_letter").as("section"))).maybe())
      .then((ref(rules, "dot").then(ref(rules, "digits_with_letter").as("subsection"))).maybe())
      .then(ref(rules, "date_dash").or(ref(rules, "date_colon")).maybe()),
  );

  const docTail = () =>
    ref(rules, "number_with_part")
      .then(ref(rules, "part_notation").maybe())
      .then(ref(rules, "date_dash").or(ref(rules, "date_colon")).maybe());

  rule("typed_identifier", () =>
    ref(rules, "publisher")
      .then(ref(rules, "doc_type"))
      .then(ref(rules, "space"))
      .then(docTail())
      .then(ref(rules, "reaffirmation").maybe()),
  );

  rule("typeless_identifier", () =>
    ref(rules, "publisher")
      .then(docTail())
      .then(ref(rules, "reaffirmation").maybe()),
  );

  rule("second_identifier", () =>
    ref(rules, "doc_type")
      .then(ref(rules, "space"))
      .then(docTail()),
  );

  rule("combined_identifier", () =>
    ref(rules, "mpms_identifier")
      .or(ref(rules, "typed_identifier"))
      .or(ref(rules, "typeless_identifier"))
      .as("first")
      .then(ref(rules, "slash"))
      .then(ref(rules, "second_identifier").as("second"))
      .then(ref(rules, "edition_notation").maybe()),
  );

  rule("identifier", () =>
    ref(rules, "combined_identifier")
      .or(ref(rules, "mpms_identifier"))
      .or(ref(rules, "typed_identifier"))
      .or(ref(rules, "typeless_identifier")),
  );

  return rules;
}

export const apiGrammar: Grammar = {
  rules: buildRules(),
  root: "identifier",
};

/** Parser#parse normalization: the MPMP typo. */
export function preprocessApi(input: string): string {
  return input.replaceAll("API MPMP", "API MPMS");
}
