//! The node entry for the ieee flavor: the fs-backed PARG runtime and
//! the grammar-barrel co-publisher routing wired into the flavor's
//! pure implementation. The implementation (./implementation.js) is
//! environment-agnostic; the worker entry (./worker.js) composes the
//! same code over parsanol's browser engine and the bundled artifact
//! (pubid/pubid-ts#232).

import { PubidRuntime } from "../../parg/runtime.js";
import { grammarImplementation } from "../index.js";
import type { FlavorImplementation, Identifier } from "../../conformance/implementation.js";
import {
  ieeeParseImpl,
  makeIeeeGrammarImplementation,
  makeIeeeParseEngine,
  type IeeeParseEngine,
} from "./implementation.js";

// The grammar runtime is the baked PARG artifact (pubid-grammar
// artifacts/ieee.json via the parsanol engine), loaded lazily from disk
// on the first parse and cached for the process.
let cachedArtifactRuntime: ReturnType<typeof PubidRuntime.load> | undefined;

function nodeEngine(): IeeeParseEngine {
  return makeIeeeParseEngine({
    parseAndBind(input: string): unknown {
      cachedArtifactRuntime ??= PubidRuntime.load("ieee");
      return cachedArtifactRuntime.parseAndBind(input);
    },
    coPublished: (flavor) => grammarImplementation(flavor),
  });
}

export function ieeeParse(input: string): Identifier {
  return ieeeParseImpl(nodeEngine(), input);
}

export function ieeeGrammarImplementation(): FlavorImplementation {
  return makeIeeeGrammarImplementation(nodeEngine());
}
