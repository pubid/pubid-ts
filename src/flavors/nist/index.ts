//! The node entry for the nist flavor: the fs-backed PARG runtime
//! wired into the flavor's pure implementation. The implementation
//! (./implementation.js) is environment-agnostic; the worker entry
//! (./worker.js) composes the same code over parsanol's browser engine
//! and the bundled artifact (pubid/pubid-ts#232).

import { PubidRuntime } from "../../parg/runtime.js";
import type { FlavorImplementation } from "../../conformance/implementation.js";
import { makeNistGrammarImplementation } from "./implementation.js";

// The grammar runtime is the baked PARG artifact (pubid-grammar
// artifacts/nist.json via the parsanol engine), loaded lazily from disk
// on the first parse and cached for the process.
let cachedNistRuntime: ReturnType<typeof PubidRuntime.load> | undefined;

export function nistGrammarImplementation(): FlavorImplementation {
  return makeNistGrammarImplementation({
    parseShape(input: string): unknown {
      cachedNistRuntime ??= PubidRuntime.load("nist");
      return cachedNistRuntime.parseShape(input);
    },
  });
}
