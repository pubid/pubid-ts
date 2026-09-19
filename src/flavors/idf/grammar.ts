import { Grammar, P, match, ref, str } from "../../grammar/engine.js";

/**
 * Port of lib/pubid/idf/parser.rb — 1:1. Root: supplement_identifier |
 * identifier_publisher.
 */

const IS_ABBRS = [
  "PWI", "NP", "NWIP", "AWI", "WD", "CD", "FCD", "DIS", "FPD", "FDIS",
  "PRF", "Fpr", "WDR", "WDA", "WDAR",
];
const RM_ABBRS = [
  "PWI RM", "NP RM", "AWI RM", "WD RM", "CD RM", "PDRM", "DRM", "FDRM",
  "PRF RM", "RM",
];
const SUPPLEMENT_ABBRS = ["AMD", "COR"];

function abbrAlternation(tokens: string[]): P {
  const sorted = [...new Set(tokens)].sort((a, b) => b.length - a.length);
  return sorted.map((t) => str(t)).reduce((a, b) => a.or(b));
}

function buildRules(): Record<string, P> {
  const rules: Record<string, P> = {};
  const rule = (name: string, build: () => P) => {
    rules[name] = build();
  };
  const space = str(" ");
  const dash = str("-").or(str("‑")).or(str("‐"));
  const word = match("\\w");
  const digit = match("\\d");
  const digits = digit.repeat(1, Infinity);

  rule("prefix_sole_publisher", () => str("IDF").as("publisher"));

  rule("number", () => word.repeat(1, 5));

  rule("date", () =>
    digits
      .then(dash.then(digit.repeat(2, 2)).maybe())
      .then(dash.then(digit.repeat(2, 2)).maybe())
      .as("date"),
  );

  rule("part_and_subpart", () =>
    dash.then(space.maybe())
      .then(word.repeat(0, Infinity))
      .then(dash.then(word.repeat(0, Infinity)).repeat(0, Infinity).maybe()),
  );

  rule("number_with_part", () =>
    ref(rules, "number").then(ref(rules, "part_and_subpart").maybe()).as("number_with_part"),
  );

  rule("all_parts", () => str("(all parts)").as("all_parts"));

  rule("type_with_stage", () =>
    abbrAlternation([...IS_ABBRS, ...RM_ABBRS]).as("type_with_stage")
      .then(digit.as("stage_iteration").then(space).maybe()),
  );

  rule("language", () =>
    str("(")
      .then(
        (
          match("[a-z]").repeat(1, Infinity).then(str(",").maybe())
        ).or(
          match("[EFARDS]").then(str("/").maybe()),
        ).repeat(0, Infinity).as("languages"),
      )
      .then(str(")")),
  );

  rule("stage_iteration", () => str(".").then(digit.as("stage_iteration")));

  rule("second_part", () =>
    ref(rules, "number_with_part")
      .then(ref(rules, "stage_iteration").maybe())
      .then(space.maybe())
      .then(str(":").then(ref(rules, "date")).maybe()),
  );

  rule("third_part", () =>
    space.maybe().then(ref(rules, "language").maybe()).then(ref(rules, "all_parts").maybe()),
  );

  rule("identifier_publisher_no_third", () =>
    ref(rules, "prefix_sole_publisher")
      .then(space.maybe())
      .then(str("/").maybe())
      .then(ref(rules, "type_with_stage").maybe())
      .then(space.maybe())
      .then(ref(rules, "second_part")),
  );

  rule("identifier_publisher", () =>
    ref(rules, "identifier_publisher_no_third").then(ref(rules, "third_part")),
  );

  rule("supplement_type_with_stage", () =>
    abbrAlternation(SUPPLEMENT_ABBRS).as("type_with_stage"),
  );

  rule("supplement_identifier_no_third", () =>
    ref(rules, "identifier_publisher_no_third").as("base")
      .then(space.maybe().then(str("/")).then(space.maybe()))
      .then(ref(rules, "supplement_type_with_stage"))
      .then(space.maybe())
      .then(ref(rules, "second_part")),
  );

  rule("supplement_identifier", () =>
    ref(rules, "supplement_identifier_no_third").then(ref(rules, "third_part")),
  );

  rule("identifier", () =>
    ref(rules, "supplement_identifier").or(ref(rules, "identifier_publisher")),
  );

  return rules;
}

export const idfGrammar: Grammar = {
  rules: buildRules(),
  root: "identifier",
};
