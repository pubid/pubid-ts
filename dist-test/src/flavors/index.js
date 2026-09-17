import { oimlGrammarImplementation } from "./oiml/implementation.js";
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
        default:
            return undefined;
    }
}
