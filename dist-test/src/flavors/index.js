import { oimlGrammarImplementation } from "./oiml/implementation.js";
import { xsfGrammarImplementation } from "./xsf/index.js";
import { doiGrammarImplementation } from "./doi/index.js";
import { ianaGrammarImplementation } from "./iana/index.js";
import { unGrammarImplementation } from "./un/index.js";
/**
 * The grammar-wave registry: flavors whose Ruby grammar has been ported
 * to a TypeScript implementation. A flavor listed here parses
 * open-endedly (real-world spellings beyond the corpus); the
 * conformance gate enforces parity with the corpus floor for it. Every
 * flavor NOT listed falls back to corpus mode.
 */
export function grammarImplementation(flavor) {
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
        default:
            return undefined;
    }
}
