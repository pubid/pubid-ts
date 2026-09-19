import { Grammar, P, ref, str } from "../../grammar/engine.js";
import { cenCenelecGrammar } from "../cen_cenelec/grammar.js";

/**
 * Port of lib/pubid/evs/parser.rb — "EVS" ("-" | " ") <CEN identifier>,
 * with the CEN/CENELEC grammar's identifier rule embedded as an atom
 * (the adopted subtree goes straight to the CEN builder as data, no
 * string re-serialization).
 */

function buildRules(): Record<string, P> {
  const rules: Record<string, P> = {};
  const rule = (name: string, build: () => P) => {
    rules[name] = build();
  };

  rule("root", () =>
    str("EVS")
      .then(str("-").or(str(" ")).as("evs_separator"))
      .then(ref(cenCenelecGrammar.rules, "identifier").as("adopted")),
  );

  return rules;
}

export const evsGrammar: Grammar = {
  rules: buildRules(),
  root: "root",
};
