import { Grammar, P, match, ref, str } from "../../grammar/engine.js";

/**
 * Port of lib/pubid/cen_cenelec/parser.rb — 1:1. Root alternation:
 * fragment_identifier | (stage_prefix|publisher) adopted? type? number
 * supplements? edition?.
 */

function buildRules(): Record<string, P> {
  const rules: Record<string, P> = {};
  const rule = (name: string, build: () => P) => {
    rules[name] = build();
  };
  const digit = match("[0-9]");
  const digits = digit.repeat(1, Infinity);
  const space = str(" ");
  const dash = str("-");
  const slash = str("/");
  const plus = str("+");
  const colon = str(":");
  const anyChar = match("[\\s\\S]");

  const publisherToken = (name: string) => str(name);

  rule("publisher", () =>
    publisherToken("CWA").or(publisherToken("HD"), publisherToken("ES"), publisherToken("CR"), publisherToken("ENV")).as("publisher")
      .or(
        publisherToken("EN").as("publisher").then(slash.then(publisherToken("CLC").as("copublisher")).maybe()),
      )
      .or(
        publisherToken("CEN").as("publisher").then(slash.then(publisherToken("CLC").as("copublisher")).maybe()),
      )
      .or(
        publisherToken("CLC").as("publisher").then(slash.then(publisherToken("CEN").as("copublisher")).maybe()),
      )
      .or(publisherToken("EN").as("publisher")),
  );

  rule("stage_prefix", () => str("FprEN").or(str("prEN")).as("type_with_stage"));

  rule("type", () => str("Guide").or(str("GUIDE"), str("TR"), str("TS")).as("type"));

  rule("number", () => digits.as("number"));

  rule("part", () => dash.then(match("[0-9-]").repeat(1, Infinity).as("part")));

  rule("parts", () => ref(rules, "part").repeat(0, Infinity).as("parts"));

  rule("year", () => colon.then(digit.repeat(4, 4).as("year")));

  rule("month_digits", () =>
    str("01").or(str("02"), str("03"), str("04"), str("05"), str("06"), str("07"), str("08"), str("09"), str("10"), str("11"), str("12")).as("month"),
  );

  rule("year_with_month", () =>
    colon.then(digit.repeat(4, 4).as("year")).then(dash).then(ref(rules, "month_digits")));

  rule("date", () => ref(rules, "year_with_month").or(ref(rules, "year")));

  rule("amendment", () =>
    plus.as("amd_sep_plus").or(slash.as("amd_sep_slash"))
      .then(str("A"))
      .then(digits.as("amd_number"))
      .then(colon.then(digit.repeat(4, 4).as("amd_year")).maybe()),
  );

  rule("corrigendum", () =>
    plus.as("amd_sep_plus").or(slash.as("amd_sep_slash"))
      .then(str("AC"))
      .then(digits.maybe().as("cor_number"))
      .then(
        ref(rules, "year_with_month")
          .or(colon.then(digit.repeat(4, 4).as("year")))
          .maybe(),
      ),
  );

  rule("supplement", () => ref(rules, "amendment").or(ref(rules, "corrigendum")).as("supplement"));

  rule("supplements", () => ref(rules, "supplement").repeat(0, Infinity).as("supplements"));

  rule("edition", () => space.then(str("ED")).then(digits.as("edition")));

  rule("fragment_identifier", () =>
    ref(rules, "stage_prefix").or(ref(rules, "publisher"))
      .then(space)
      .then(ref(rules, "number"))
      .then(ref(rules, "parts"))
      .then(space)
      .then(str("AMD"))
      .then(digits.as("amendment_number"))
      .then(space)
      .then(str("FRAG"))
      .then(digits.as("fragment_number")),
  );

  rule("adopted_org_prefix", () => str("ISO").or(str("IEC"), str("CISPR")));

  rule("adopted_string", () =>
    ref(rules, "adopted_org_prefix")
      .then(
        ref(rules, "supplement").absent()
          .then(ref(rules, "edition").absent())
          .then(anyChar)
          .repeat(0, Infinity),
      )
      .as("adopted_string"),
  );

  rule("identifier", () =>
    ref(rules, "fragment_identifier").or(
      ref(rules, "stage_prefix").or(ref(rules, "publisher"))
        .then(space.then(ref(rules, "adopted_string")).maybe())
        .then(
          space.then(ref(rules, "type")).or(slash.then(ref(rules, "type"))).maybe(),
        )
        .then(
          space.then(ref(rules, "number")).then(ref(rules, "parts"))
            .then(ref(rules, "year").maybe())
            .maybe(),
        )
        .then(ref(rules, "supplements"))
        .then(ref(rules, "edition").maybe()),
    ),
  );

  return rules;
}

export const cenCenelecGrammar: Grammar = {
  rules: buildRules(),
  root: "identifier",
};

/** Parser.parse normalization (parser.rb self.parse). */
export function preprocessCenCenelec(input: string): string {
  let normalized = input.replace(/[‑­]/g, "-");
  normalized = normalized.replace(/#.*$/, "").trim();
  normalized = normalized.replace(/\s*\([^)]*corrigendum[^)]*\)/i, "");
  normalized = normalized
    .replaceAll("CEN-CLC", "CEN/CLC")
    .replaceAll("CLC-CEN", "CLC/CEN")
    .replaceAll("GUIDE", "Guide");
  return normalized;
}
