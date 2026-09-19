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
import { ihoGrammarImplementation } from "./iho/index.js";
import { calconnectGrammarImplementation } from "./calconnect/index.js";
import { gbGrammarImplementation } from "./gb/index.js";
import { jcgmGrammarImplementation } from "./jcgm/index.js";
import { etsiGrammarImplementation } from "./etsi/index.js";
import { jisGrammarImplementation } from "./jis/index.js";
import { iecGrammarImplementation } from "./iec/index.js";
import { cieGrammarImplementation } from "./cie/index.js";
import { bipmGrammarImplementation } from "./bipm/index.js";
import { isoGrammarImplementation } from "./iso/index.js";
import { ituGrammarImplementation } from "./itu/index.js";
import { ietfGrammarImplementation } from "./ietf/index.js";
import { ialaGrammarImplementation } from "./iala/index.js";

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
    case "iho":
      return ihoGrammarImplementation();
    case "calconnect":
      return calconnectGrammarImplementation();
    case "gb":
      return gbGrammarImplementation();
    case "jcgm":
      return jcgmGrammarImplementation();
    case "etsi":
      return etsiGrammarImplementation();
    case "jis":
      return jisGrammarImplementation();
    case "iec":
      return iecGrammarImplementation();
    case "cie":
      return cieGrammarImplementation();
    case "bipm":
      return bipmGrammarImplementation();
    case "iso":
      return isoGrammarImplementation();
    case "itu":
      return ituGrammarImplementation();
    case "ietf":
      return ietfGrammarImplementation();
    case "iala":
      return ialaGrammarImplementation();
    default:
      return undefined;
  }
}
