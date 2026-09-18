import type { FlavorImplementation } from "../conformance/implementation.js";
import { oimlGrammarImplementation } from "./oiml/implementation.js";
import { xsfGrammarImplementation } from "./xsf/index.js";
import { doiGrammarImplementation } from "./doi/index.js";
import { ianaGrammarImplementation } from "./iana/index.js";
import { unGrammarImplementation } from "./un/index.js";
import { plateauGrammarImplementation } from "./plateau/index.js";
import { w3cGrammarImplementation } from "./w3c/index.js";
import { omgGrammarImplementation } from "./omg/index.js";
import { ogcGrammarImplementation } from "./ogc/index.js";
import { isbnGrammarImplementation } from "./isbn/index.js";
import { eascGrammarImplementation } from "./easc/index.js";
import { ecmaGrammarImplementation } from "./ecma/index.js";
import { tgppGrammarImplementation } from "./tgpp/index.js";
import { ansiGrammarImplementation } from "./ansi/index.js";
import { oasisGrammarImplementation } from "./oasis/index.js";

/**
 * The grammar-wave registry: flavors whose Ruby grammar has been ported
 * to a TypeScript implementation. A flavor listed here parses
 * open-endedly (real-world spellings beyond the corpus); the
 * conformance gate enforces parity with the corpus floor for it. Every
 * flavor NOT listed falls back to corpus mode.
 */
export function grammarImplementation(flavor: string): FlavorImplementation | undefined {
  switch (flavor) {
    case "oiml":
      return oimlGrammarImplementation();
    case "xsf":
      return xsfGrammarImplementation();
    case "doi":
      return doiGrammarImplementation();
    case "iana":
      return ianaGrammarImplementation();
    case "un":
      return unGrammarImplementation();
    case "plateau":
      return plateauGrammarImplementation();
    case "w3c":
      return w3cGrammarImplementation();
    case "omg":
      return omgGrammarImplementation();
    case "ogc":
      return ogcGrammarImplementation();
    case "isbn":
      return isbnGrammarImplementation();
    case "easc":
      return eascGrammarImplementation();
    case "ecma":
      return ecmaGrammarImplementation();
    case "tgpp":
      return tgppGrammarImplementation();
    case "ansi":
      return ansiGrammarImplementation();
    case "oasis":
      return oasisGrammarImplementation();
    default:
      return undefined;
  }
}
