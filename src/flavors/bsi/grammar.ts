import { Grammar, P, match, ref, str } from "../../grammar/engine.js";

/**
 * Port of lib/pubid/bsi/parser.rb — 1:1. Root: identifier.
 *
 * Branch order (most specific first): standalone amendment, committee
 * document, index/supplementary-index/explanatory-supplement/method/
 * test-method/section/detailed-spec, aerospace with letter edition,
 * DISC, supplement document (reverse then forward), addendum document,
 * set, bundled, bare adopted, flex, regular.
 */

/** Case-insensitive string match (parser.rb #stri). */
function stri(input: string): P {
  const parts: P[] = [];
  for (const char of input) {
    if (/[a-z]/i.test(char)) {
      parts.push(match(`[${char.toUpperCase()}${char.toLowerCase()}]`));
    } else {
      parts.push(str(char));
    }
  }
  return parts.reduce((a, b) => a.then(b));
}

const alt = (tokens: string[]): P =>
  tokens.map((t) => str(t)).reduce((a, b) => a.or(b));

function buildRules(): Record<string, P> {
  const rules: Record<string, P> = {};
  const rule = (name: string, build: () => P) => {
    rules[name] = build();
  };

  rule("digit", () => match("[0-9]"));
  rule("digits", () => ref(rules, "digit").repeat(1, Infinity));
  rule("space", () => str(" "));
  rule("dash", () => str("-"));
  rule("slash", () => str("/"));
  rule("plus", () => str("+"));
  rule("colon", () => str(":"));

  rule("bs", () => str("BS").or(str("BSI")));

  rule("multi_letter_prefix", () =>
    alt([
      "E9111", "CECC", "CISPR",
      "2HC", "2HR", "2SP", "2TA", "3HR", "3TA",
      "2A", "2B", "2C", "2F", "2G", "2L", "2M", "2S",
      "3B", "3F", "3G", "3J", "3L", "3S",
      "4F", "4L", "4S", "5S", "7S",
      "SP",
    ]),
  );

  rule("single_letter_prefix", () =>
    alt(["AU", "HC", "MA", "PL", "QC", "TA", "A", "B", "C", "F", "G", "L", "M", "S", "X"]),
  );

  rule("specialized_prefix", () =>
    ref(rules, "multi_letter_prefix")
      .or(ref(rules, "single_letter_prefix"))
      .as("prefix"),
  );

  rule("flex", () => str("BSI Flex").or(str("BS Flex")).or(str("Flex")));

  rule("dd", () => str("DD"));
  rule("pd", () => str("PD"));
  rule("pas", () => str("PAS"));
  rule("na", () => str("NA"));
  rule("ts", () => str("TS"));
  rule("handbook", () => str("Handbook").or(str("HB")));
  rule("pp", () => str("PP"));
  rule("bip", () => str("BIP"));
  rule("ep_type", () => str("EP").or(str("ep")));

  rule("index_suffix", () =>
    ref(rules, "space").then(str("Index")).then(ref(rules, "space")).then(str("Issue"))
      .then(ref(rules, "space")).then(ref(rules, "digits").as("issue_number"))
      .or(
        ref(rules, "colon").as("colon_sep").then(str("Index")),
      )
      .or(
        ref(rules, "space").then(str("Index")),
      ),
  );

  rule("supplementary_index_suffix", () =>
    ref(rules, "space").then(str("Supplementary Index")),
  );

  rule("explanatory_supplement_suffix", () =>
    ref(rules, "colon").then(str("Explanatory Supplement")),
  );

  rule("method_code", () => match("[0-9A-Z]").repeat(1, Infinity));

  rule("method_suffix", () =>
    ref(rules, "colon").then(str("Methods")).then(ref(rules, "space"))
      .then(ref(rules, "method_code").as("method_code"))
      .then(ref(rules, "space")).then(str("to")).then(ref(rules, "space"))
      .then(ref(rules, "method_code").as("method_to"))
      .or(
        ref(rules, "colon").then(str("Methods")).then(ref(rules, "space"))
          .then(ref(rules, "method_code").as("method_code"))
          .then(ref(rules, "space")).then(str("and")).then(ref(rules, "space"))
          .then(ref(rules, "method_code").as("method_and")),
      )
      .or(
        ref(rules, "colon").then(str("Method")).then(ref(rules, "space"))
          .then(ref(rules, "method_code").as("method_code")),
      ),
  );

  rule("test_method_suffix", () =>
    ref(rules, "colon")
      .then(match("[0-9A-Z]").repeat(1, Infinity).as("test_series"))
      .then(ref(rules, "colon"))
      .then(match("[0-9A-Z]").repeat(1, Infinity).as("test_id")),
  );

  rule("set_separator", () =>
    ref(rules, "space").maybe().then(str("+")).then(ref(rules, "space").maybe()),
  );

  rule("set_item", () =>
    ref(rules, "bs").as("publisher")
      .then(ref(rules, "space"))
      .then(
        ref(rules, "adopted_org_prefix").as("adopted_org")
          .then(ref(rules, "space"))
          .maybe(),
      )
      .then(ref(rules, "number"))
      .then(ref(rules, "parts").maybe())
      .then(ref(rules, "year").maybe())
      .as("set_item"),
  );

  rule("set_items", () =>
    ref(rules, "set_item")
      .then(
        (ref(rules, "set_separator").then(ref(rules, "set_item"))).repeat(1, Infinity),
      ),
  );

  rule("set_identifier", () => ref(rules, "set_items").as("set"));

  rule("section_id", () => match("[0-9A-Za-z]").repeat(1, Infinity));

  rule("section_suffix", () =>
    ref(rules, "colon").as("colon_sep").then(str("Section")).then(ref(rules, "space"))
      .then(ref(rules, "section_id").as("section_id"))
      .or(
        ref(rules, "space").then(str("Section")).then(ref(rules, "space"))
          .then(ref(rules, "section_id").as("section_id")),
      ),
  );

  rule("detailed_spec_suffix", () =>
    ref(rules, "space")
      .then(
        str("C")
          .then(match("[0-9]").repeat(1, 3))
          .then(ref(rules, "dash"))
          .then(match("[0-9]").repeat(1, 3))
          .as("spec_code")
          .or(
            str("N")
              .then(match("[0-9]").repeat(1, 4))
              .then(
                (ref(rules, "dash").then(match("[0-9]").repeat(1, Infinity))).maybe(),
              )
              .as("spec_code"),
          ),
      ),
  );

  rule("committee_document", () =>
    ref(rules, "digit").repeat(2, 2).as("year")
      .then(ref(rules, "slash"))
      .then(match("[0-9]").repeat(8, 8).as("document_number"))
      .then(ref(rules, "space"))
      .then(str("DC"))
      .as("committee_document"),
  );

  rule("standalone_amendment", () =>
    str("(").then(str("AMD")).then(ref(rules, "space"))
      .then(str("Corrigendum").as("corrigendum"))
      .then(ref(rules, "space"))
      .then(ref(rules, "digits").as("amendment_number"))
      .then(str(")"))
      .as("parenthesized_amd")
      .or(
        str("(").then(str("AMD")).then(ref(rules, "space"))
          .then(ref(rules, "digits").as("amendment_number"))
          .then(str(")"))
          .as("parenthesized_amd"),
      )
      .or(
        str("AMD").then(ref(rules, "space"))
          .then(str("Corrigendum").as("corrigendum"))
          .then(ref(rules, "space"))
          .then(ref(rules, "digits").as("amendment_number"))
          .as("standalone_amendment"),
      )
      .or(
        str("AMD").then(ref(rules, "space"))
          .then(ref(rules, "digits").as("amendment_number"))
          .as("standalone_amendment"),
      ),
  );

  rule("disc_prefix", () => str("DISC PD "));

  rule("draft", () => str("Draft BS").or(str("DBS")));

  rule("en", () => str("EN"));
  rule("iso", () => str("ISO"));
  rule("iec", () => str("IEC"));
  rule("cispr", () => str("CISPR"));
  rule("cen", () => str("CEN"));
  rule("clc", () => str("CLC"));

  rule("na_with_supplements", () =>
    str("NA")
      .then(ref(rules, "any_supplement").repeat(1, Infinity).as("na_supplements"))
      .then(ref(rules, "space"))
      .then(str("to ")),
  );

  rule("na_simple", () => str("NA to "));

  rule("na_prefix", () =>
    ref(rules, "na_with_supplements").or(ref(rules, "na_simple")).as("na_prefix"),
  );

  rule("publisher_or_type", () =>
    ref(rules, "na_prefix")
      .then(
        ref(rules, "draft").as("stage")
          .or(ref(rules, "dd").as("type"))
          .or(ref(rules, "pd").as("type"))
          .or(ref(rules, "bs").as("publisher")),
      )
      .or(ref(rules, "flex").as("flex_type"))
      .or(ref(rules, "handbook").as("type"))
      .or(ref(rules, "bip").as("type"))
      .or(ref(rules, "ts").as("type"))
      .or(ref(rules, "ep_type").as("type"))
      .or(ref(rules, "draft").as("stage"))
      .or(ref(rules, "dd").as("type"))
      .or(ref(rules, "pd").as("type"))
      .or(ref(rules, "pas").as("type"))
      .or(ref(rules, "pp").as("type"))
      .or(ref(rules, "na").as("type"))
      .or(
        ref(rules, "bs").as("publisher")
          .then(ref(rules, "space"))
          .then(ref(rules, "specialized_prefix")),
      )
      .or(ref(rules, "bs").as("publisher")),
  );

  rule("number", () => match("[0-9A-Z]").repeat(1, Infinity).as("number"));

  rule("bracket_iteration", () =>
    str("[").then(match("[0-9]").repeat(1, Infinity).as("iteration")).then(str("]")),
  );

  rule("part_with_subpart", () =>
    ref(rules, "dash").then(ref(rules, "digits").as("part"))
      .then(ref(rules, "dash"))
      .then(ref(rules, "digits").as("subpart")),
  );

  rule("part", () =>
    ref(rules, "dash").then(match("[0-9A-Za-z.& ]").repeat(1, Infinity).as("part")),
  );

  rule("parts", () =>
    ref(rules, "part_with_subpart").or(ref(rules, "part")).repeat(0, Infinity).as("parts"),
  );

  rule("letter_edition", () => match("[a-zA-Z]").as("letter_edition"));

  rule("part_with_letter_edition", () =>
    ref(rules, "dash").then(match("[0-9.]").repeat(1, Infinity).as("part"))
      .then(ref(rules, "letter_edition").as("letter_edition"))
      .or(
        ref(rules, "dash").then(match("[0-9.]").repeat(1, Infinity).as("part")),
      ),
  );

  rule("number_with_letter_edition", () =>
    match("[0-9]").repeat(1, Infinity).as("number")
      .then(ref(rules, "letter_edition").as("letter_edition"))
      .or(match("[0-9]").repeat(1, Infinity).as("number")),
  );

  rule("space_separated_part", () =>
    ref(rules, "space")
      .then(
        (match("[A-Z]").repeat(1, Infinity).then(match("[0-9]").repeat(1, Infinity))).as("part"),
      ),
  );

  rule("iteration", () =>
    ref(rules, "bracket_iteration").repeat(0, Infinity).as("iteration"),
  );

  rule("year", () => ref(rules, "colon").then(ref(rules, "digit").repeat(3, 4).as("year")));

  rule("base_year", () =>
    ref(rules, "colon").then(ref(rules, "digit").repeat(4, 4).as("base_year")),
  );

  rule("month", () =>
    ref(rules, "dash").then(ref(rules, "digit").repeat(2, 2).as("month")),
  );

  rule("flex_edition", () =>
    ref(rules, "space").then(str("v")).then(match("[0-9.]").repeat(1, Infinity).as("edition")),
  );

  rule("edition", () =>
    ref(rules, "space").then(str("ED")).then(ref(rules, "digits").as("edition")),
  );

  const sepAlt = () => ref(rules, "plus").as("amd_sep_plus").or(ref(rules, "slash").as("amd_sep_slash"));

  rule("amendment_impl", () =>
    sepAlt()
      .then(str("A"))
      .then(ref(rules, "digits").as("amd_number"))
      .then(
        (ref(rules, "colon").then(ref(rules, "digit").repeat(2, 4).as("amd_year"))).maybe(),
      )
      .or(
        sepAlt()
          .then(str("Amd"))
          .then(ref(rules, "space"))
          .then(ref(rules, "digits").as("amd_number"))
          .then(
            (ref(rules, "colon").then(ref(rules, "digit").repeat(4, 4).as("amd_year"))).maybe(),
          ),
      ),
  );

  rule("corrigendum_impl", () =>
    sepAlt()
      .then(str("AC"))
      .then(ref(rules, "digits").maybe().as("cor_number"))
      .then(
        (ref(rules, "colon").then(ref(rules, "digit").repeat(2, 4).as("cor_year"))).maybe(),
      )
      .or(
        sepAlt()
          .then(str("C"))
          .then(ref(rules, "digits").as("cor_number"))
          .then(
            (ref(rules, "colon").then(ref(rules, "digit").repeat(2, 4).as("cor_year"))).maybe(),
          ),
      ),
  );

  rule("amd_suffix", () =>
    ref(rules, "space").then(str("AMD")).then(ref(rules, "space").maybe())
      .then(
        match("[0-9]").repeat(1, Infinity).as("amd_number")
          .or(match("[A-Z]").repeat(1, Infinity).as("amd_letter")),
      ),
  );

  rule("amd_verbose", () =>
    ref(rules, "space")
      .then(str("Amd").or(str("Amendment")).as("amd_verbose_type"))
      .then(ref(rules, "space"))
      .then(match("[0-9]").repeat(1, Infinity).as("amd_number"))
      .then(
        (ref(rules, "space").then(str("(")).then(match("[0-9/]").repeat(1, Infinity).as("amd_date")).then(str(")"))).maybe(),
      )
      .then(
        (ref(rules, "colon").then(match("[A-Za-z]").repeat(1, Infinity).as("amd_month"))
          .then(ref(rules, "space"))
          .then(ref(rules, "digit").repeat(4, 4).as("amd_year"))).maybe(),
      ),
  );

  const suppDocPrefix = (prefixRule: string) =>
    ref(rules, "bs").as("publisher")
      .then(ref(rules, "space"))
      .then(ref(rules, prefixRule).as("flex_prefix"))
      .then(ref(rules, "space"))
      .then(ref(rules, "number").as("number"))
      .then(ref(rules, "iteration").as("iteration"))
      .then(ref(rules, "parts").as("parts"));

  const plainDocPrefix = () =>
    ref(rules, "bs").as("publisher")
      .then(ref(rules, "space"))
      .then(ref(rules, "number").as("number"))
      .then(ref(rules, "iteration").as("iteration"))
      .then(ref(rules, "parts").as("parts"));

  // The renderer prints "Addendum"/"Supplement" + (" No.")? + TWO
  // spaces before the number; both seams accept one-or-more spaces.
  const supplementTail = (word: string, sepKey: string, noKey: string, numKey: string, yearKey: string) =>
    (ref(rules, "colon").or(ref(rules, "space"))).as(sepKey)
      .then(str(word))
      .then(ref(rules, "space").repeat(1, Infinity))
      .then(str("No.").as(noKey))
      .then(ref(rules, "space").repeat(1, Infinity))
      .then(ref(rules, "digits").as(numKey))
      .then(ref(rules, "colon"))
      .then(ref(rules, "digit").repeat(4, 4).as(yearKey))
      .or(
        (ref(rules, "colon").or(ref(rules, "space"))).as(sepKey)
          .then(str(word))
          .then(ref(rules, "space").repeat(1, Infinity))
          .then(ref(rules, "digits").as(numKey))
          .then(ref(rules, "colon"))
          .then(ref(rules, "digit").repeat(4, 4).as(yearKey)),
      );

  rule("supplement_document_forward", () =>
    suppDocPrefix("multi_letter_prefix")
      .then(supplementTail("Supplement", "supp_sep", "supp_no_prefix", "supplement_number", "supplement_year"))
      .as("supplement_document")
      .or(
        suppDocPrefix("single_letter_prefix")
          .then(supplementTail("Supplement", "supp_sep", "supp_no_prefix", "supplement_number", "supplement_year"))
          .as("supplement_document"),
      )
      .or(
        plainDocPrefix()
          .then(supplementTail("Supplement", "supp_sep", "supp_no_prefix", "supplement_number", "supplement_year"))
          .as("supplement_document"),
      ),
  );

  rule("supplement_document_reverse", () =>
    str("Supplement").then(ref(rules, "space"))
      .then(str("No.").as("supp_no_prefix"))
      .then(ref(rules, "space"))
      .then(ref(rules, "digits").as("supplement_number"))
      .then(ref(rules, "space"))
      .then(str("("))
      .then(ref(rules, "digit").repeat(4, 4).as("supplement_year"))
      .then(str(")"))
      .then(ref(rules, "space"))
      .then(str("to "))
      .then(ref(rules, "bs").as("publisher"))
      .then(ref(rules, "space"))
      .then(ref(rules, "number").as("number"))
      .then(ref(rules, "iteration").as("iteration"))
      .then(ref(rules, "parts").as("parts"))
      .then(ref(rules, "colon"))
      .then(ref(rules, "digit").repeat(4, 4).as("base_year"))
      .as("supplement_document")
      .or(
        str("Supplement").then(ref(rules, "space"))
          .then(ref(rules, "digits").as("supplement_number"))
          .then(ref(rules, "space"))
          .then(str("("))
          .then(ref(rules, "digit").repeat(4, 4).as("supplement_year"))
          .then(str(")"))
          .then(ref(rules, "space"))
          .then(str("to "))
          .then(ref(rules, "bs").as("publisher"))
          .then(ref(rules, "space"))
          .then(ref(rules, "number").as("number"))
          .then(ref(rules, "iteration").as("iteration"))
          .then(ref(rules, "parts").as("parts"))
          .then(ref(rules, "colon"))
          .then(ref(rules, "digit").repeat(4, 4).as("base_year"))
          .as("supplement_document"),
      ),
  );

  rule("addendum_document", () =>
    suppDocPrefix("multi_letter_prefix")
      .then(supplementTail("Addendum", "add_sep", "add_no_prefix", "addendum_number", "addendum_year"))
      .as("addendum_document")
      .or(
        suppDocPrefix("single_letter_prefix")
          .then(supplementTail("Addendum", "add_sep", "add_no_prefix", "addendum_number", "addendum_year"))
          .as("addendum_document"),
      )
      .or(
        plainDocPrefix()
          .then(ref(rules, "base_year"))
          .then(ref(rules, "space").as("add_sep"))
          .then(str("Addendum"))
          .then(ref(rules, "space").repeat(1, Infinity))
          .then(str("No.").as("add_no_prefix"))
          .then(ref(rules, "space").repeat(1, Infinity))
          .then(ref(rules, "digits").as("addendum_number"))
          .then(ref(rules, "colon"))
          .then(ref(rules, "digit").repeat(4, 4).as("addendum_year"))
          .as("addendum_document"),
      )
      .or(
        plainDocPrefix()
          .then(ref(rules, "base_year"))
          .then(ref(rules, "colon").as("add_sep"))
          .then(str("Addendum"))
          .then(ref(rules, "space").repeat(1, Infinity))
          .then(str("No.").as("add_no_prefix"))
          .then(ref(rules, "space").repeat(1, Infinity))
          .then(ref(rules, "digits").as("addendum_number"))
          .then(ref(rules, "colon"))
          .then(ref(rules, "digit").repeat(4, 4).as("addendum_year"))
          .as("addendum_document"),
      )
      .or(
        plainDocPrefix()
          .then(supplementTail("Addendum", "add_sep", "add_no_prefix", "addendum_number", "addendum_year"))
          .as("addendum_document"),
      ),
  );

  rule("bundle_sep_and", () =>
    ref(rules, "space").then(str("and")).then(ref(rules, "space")),
  );

  rule("bundle_sep_to", () =>
    ref(rules, "space").then(str("TO").or(str("to")).as("to_case")).then(ref(rules, "space")),
  );

  rule("bundle_sep_ampersand", () =>
    ref(rules, "space").then(str("&")).then(ref(rules, "space")),
  );

  rule("bundle_sep_semicolon", () => str(";").then(ref(rules, "space")));

  rule("bundle_sep_comma", () => str(","));

  rule("bundle_separator", () =>
    ref(rules, "bundle_sep_and").as("sep_and")
      .or(ref(rules, "bundle_sep_to").as("sep_to"))
      .or(ref(rules, "bundle_sep_ampersand").as("sep_ampersand"))
      .or(ref(rules, "bundle_sep_semicolon").as("sep_semicolon"))
      .or(ref(rules, "bundle_sep_comma").as("sep_comma")),
  );

  rule("parts_bundle", () =>
    str("Parts").or(str("Sections")).as("bundle_type")
      .then(ref(rules, "space"))
      .then(match("[0-9]").repeat(1, Infinity).as("part1"))
      .then(ref(rules, "bundle_sep_and"))
      .then(match("[0-9.]").repeat(1, Infinity).as("part2")),
  );

  rule("bundle_item", () =>
    ref(rules, "bs").as("publisher")
      .then(ref(rules, "space"))
      .then(ref(rules, "multi_letter_prefix").as("prefix"))
      .then(ref(rules, "space"))
      .then(ref(rules, "number"))
      .then(ref(rules, "parts"))
      .as("bundle_item")
      .or(
        ref(rules, "bs").as("publisher")
          .then(ref(rules, "space"))
          .then(ref(rules, "single_letter_prefix").as("prefix"))
          .then(ref(rules, "space"))
          .then(ref(rules, "number"))
          .then(ref(rules, "parts"))
          .as("bundle_item"),
      )
      .or(
        ref(rules, "bs").as("publisher")
          .then(ref(rules, "space"))
          .then(ref(rules, "number"))
          .then(ref(rules, "space_separated_part"))
          .as("bundle_item"),
      )
      .or(
        ref(rules, "bs").as("publisher")
          .then(ref(rules, "space"))
          .then(ref(rules, "number"))
          .then(ref(rules, "parts"))
          .as("bundle_item"),
      )
      .or(
        ref(rules, "multi_letter_prefix").as("prefix")
          .then(ref(rules, "space"))
          .then(ref(rules, "number"))
          .then(ref(rules, "parts"))
          .as("bundle_item"),
      )
      .or(
        ref(rules, "single_letter_prefix").as("prefix")
          .then(ref(rules, "space"))
          .then(ref(rules, "number"))
          .then(ref(rules, "parts"))
          .as("bundle_item"),
      )
      .or(
        ref(rules, "number")
          .then(ref(rules, "space_separated_part"))
          .as("bundle_item"),
      )
      .or(
        (match("[A-Z]").repeat(1, Infinity).then(match("[0-9]").repeat(1, Infinity))).as("bundle_item"),
      )
      .or(
        ref(rules, "number")
          .then(ref(rules, "parts"))
          .as("bundle_item"),
      ),
  );

  rule("bundled_identifier", () =>
    ref(rules, "publisher_or_type")
      .then(ref(rules, "space"))
      .then(ref(rules, "number"))
      .then(ref(rules, "colon"))
      .then(ref(rules, "parts_bundle"))
      .then(ref(rules, "year"))
      .as("bundled_parts")
      .or(
        ref(rules, "publisher_or_type")
          .then(ref(rules, "space"))
          .then(ref(rules, "bundle_item"))
          .then(
            (ref(rules, "bundle_separator").then(ref(rules, "bundle_item"))).repeat(1, Infinity),
          )
          .then(ref(rules, "year").maybe())
          .as("bundled_list"),
      ),
  );

  // supplement = amendment | corrigendum | amd_suffix | amd_verbose
  rule("any_supplement", () =>
    ref(rules, "amendment_impl")
      .or(ref(rules, "corrigendum_impl"))
      .or(ref(rules, "amd_suffix"))
      .or(ref(rules, "amd_verbose"))
      .as("supplement"),
  );

  rule("supplements", () =>
    ref(rules, "any_supplement").repeat(0, Infinity).as("supplements"),
  );

  rule("expert_commentary", () =>
    ref(rules, "space")
      .then(
        stri("Expert Commentary").as("expert_commentary_full")
          .or(
            stri("ExComm")
              .then(
                (ref(rules, "space").then(str("("))
                  .then(match("[A-Za-z]").repeat(1, Infinity).as("expert_commentary_topic"))
                  .then(str(")"))).maybe(),
              )
              .as("expert_commentary"),
          ),
      ),
  );

  rule("tracked_changes", () =>
    ref(rules, "space").then(ref(rules, "dash")).then(ref(rules, "space")).then(str("TC").as("tracked_changes")),
  );

  rule("pdf_suffix", () => ref(rules, "space").then(str("PDF").as("pdf")));

  rule("translation", () =>
    ref(rules, "space").then(str("("))
      .then(
        match("[A-Za-z]").repeat(1, Infinity).as("translation_lang")
          .then(
            (ref(rules, "space").then(str("Translation").or(str("version")))).maybe(),
          ),
      )
      .then(str(")"))
      .or(
        ref(rules, "space")
          .then(alt(["SPANISH", "FRENCH", "GERMAN", "ITALIAN"]).as("translation_upper"))
          .then(ref(rules, "space"))
          .then(str("TRANSLATION")),
      ),
  );

  rule("collection_number", () =>
    ref(rules, "slash").then(ref(rules, "digits").as("second_number")),
  );

  rule("adopted_org_prefix", () =>
    alt(["EN", "ISO", "IEC", "CISPR", "CEN", "CLC", "CR", "ES", "ENV", "HD", "CWA"]),
  );

  rule("adopted_string_no_expert", () =>
    ref(rules, "adopted_org_prefix")
      .then(match("[^E\\n]").repeat(1, Infinity).as("adopted_string_no_expert")),
  );

  rule("adopted_string_content", () =>
    ref(rules, "any_supplement").absent()
      .then(ref(rules, "amd_suffix").absent())
      .then(ref(rules, "amd_verbose").absent())
      .then(ref(rules, "expert_commentary").absent())
      .then(ref(rules, "tracked_changes").absent())
      .then(ref(rules, "pdf_suffix").absent())
      .then(ref(rules, "translation").absent())
      .then(match("[^\\n]").repeat(1, Infinity)),
  );

  rule("adopted_string", () =>
    ref(rules, "adopted_org_prefix")
      .then(ref(rules, "adopted_string_content"))
      .as("adopted_string"),
  );

  rule("bare_adopted", () =>
    ref(rules, "bs").absent()
      .then(ref(rules, "adopted_org_prefix"))
      .then(
        (
          ref(rules, "any_supplement").absent()
            .then(ref(rules, "amd_suffix").absent())
            .then(ref(rules, "amd_verbose").absent())
            .then(ref(rules, "tracked_changes").absent())
            .then(ref(rules, "pdf_suffix").absent())
            .then(ref(rules, "translation").absent())
            .then(match("[^\\n]"))
        ).repeat(0, Infinity),
      )
      .as("adopted_string"),
  );

  rule("vapSuffix", () =>
    ref(rules, "space").then(str("PDF").as("pdf_format"))
      .or(ref(rules, "space").then(str("BOOK").as("book_format")))
      .or(
        ref(rules, "space").then(ref(rules, "dash")).then(ref(rules, "space")).then(str("TC").as("tc_format")),
      ),
  );

  rule("identifier", () =>
    ref(rules, "standalone_amendment")
      .or(ref(rules, "committee_document"))
      .or(
        ref(rules, "bs").as("publisher").then(ref(rules, "space"))
          .then(ref(rules, "number"))
          .then(ref(rules, "index_suffix").as("index_suffix"))
          .then(ref(rules, "year"))
          .as("index_identifier"),
      )
      .or(
        ref(rules, "bs").as("publisher").then(ref(rules, "space"))
          .then(ref(rules, "number"))
          .then(ref(rules, "supplementary_index_suffix").as("supplementary_index_suffix"))
          .then(ref(rules, "year"))
          .as("supplementary_index_identifier"),
      )
      .or(
        ref(rules, "bs").as("publisher").then(ref(rules, "space"))
          .then(ref(rules, "number"))
          .then(ref(rules, "parts"))
          .then(ref(rules, "explanatory_supplement_suffix").as("explanatory_supplement_suffix"))
          .then(ref(rules, "year"))
          .as("explanatory_supplement_identifier"),
      )
      .or(
        ref(rules, "bs").as("publisher").then(ref(rules, "space"))
          .then(ref(rules, "number"))
          .then(ref(rules, "parts"))
          .then(ref(rules, "method_suffix").as("method_suffix"))
          .then(ref(rules, "year"))
          .as("method_identifier"),
      )
      .or(
        ref(rules, "bs").as("publisher").then(ref(rules, "space"))
          .then(ref(rules, "number"))
          .then(ref(rules, "test_method_suffix").as("test_method_suffix"))
          .then(ref(rules, "year"))
          .as("test_method_identifier"),
      )
      .or(
        ref(rules, "publisher_or_type")
          .then(ref(rules, "space"))
          .then(ref(rules, "number"))
          .then(ref(rules, "section_suffix").as("section_suffix"))
          .then(ref(rules, "year"))
          .as("section_identifier"),
      )
      .or(
        ref(rules, "bs").as("publisher").then(ref(rules, "space"))
          .then(ref(rules, "number"))
          .then(ref(rules, "detailed_spec_suffix").as("detailed_spec_suffix"))
          .then(ref(rules, "year"))
          .as("detailed_specification"),
      )
      .or(
        ref(rules, "bs").as("publisher").then(ref(rules, "space"))
          .then(
            ref(rules, "single_letter_prefix").or(ref(rules, "multi_letter_prefix")).as("prefix"),
          )
          .then(ref(rules, "space"))
          .then(ref(rules, "number_with_letter_edition"))
          .then(ref(rules, "part_with_letter_edition").maybe())
          .then(ref(rules, "iteration").as("iteration").maybe())
          .then(ref(rules, "year"))
          .then(ref(rules, "supplements"))
          .as("aerospace_identifier"),
      )
      .or(
        ref(rules, "disc_prefix")
          .then(ref(rules, "number"))
          .then(ref(rules, "parts").maybe())
          .then(ref(rules, "year"))
          .as("disc_identifier"),
      )
      // The reverse rule already .as-wraps itself; an outer wrap would
      // nest supplement_document twice and the builder sees empty keys.
      .or(ref(rules, "supplement_document_reverse"))
      .or(ref(rules, "supplement_document_forward"))
      .or(ref(rules, "addendum_document"))
      // set_identifier already .as-wraps as "set"; an outer wrap nests twice.
      .or(ref(rules, "set_identifier"))
      .or(ref(rules, "bundled_identifier"))
      .or(ref(rules, "bare_adopted").as("adopted_string"))
      .or(
        ref(rules, "flex").as("flex_type")
          .then(ref(rules, "space"))
          .then(ref(rules, "number"))
          .then(ref(rules, "parts"))
          .then(ref(rules, "flex_edition").maybe())
          .then(
            (ref(rules, "year").then(ref(rules, "month").maybe())).maybe(),
          )
          .then(ref(rules, "supplements")),
      )
      .or(
        ref(rules, "publisher_or_type")
          .then((ref(rules, "space").then(ref(rules, "adopted_string"))).maybe())
          .then(
            (
              ref(rules, "space")
                .then(ref(rules, "number"))
                .then(ref(rules, "parts"))
                .then(ref(rules, "collection_number").maybe())
                .then((ref(rules, "year").then(ref(rules, "month").maybe())).maybe())
                .then(ref(rules, "flex_edition").maybe())
            ).maybe(),
          )
          .then(ref(rules, "supplements").maybe())
          .then(ref(rules, "edition").maybe())
          .then(ref(rules, "expert_commentary").maybe())
          .then(ref(rules, "translation").maybe())
          .then(ref(rules, "vapSuffix").maybe()),
      ),
  );

  return rules;
}

export const bsiGrammar: Grammar = {
  rules: buildRules(),
  root: "identifier",
};

/** Parser.parse normalization: "BSI " → "BS " except "BSI Flex". */
export function preprocessBsi(input: string): string {
  return input.startsWith("BSI Flex")
    ? input
    : input.replaceAll(/\bBSI\s+/g, "BS ");
}
