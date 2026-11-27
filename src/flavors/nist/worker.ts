//! The worker entry for the nist flavor (pubid/pubid-ts#232): the same
//! implementation the node entry runs, over the bundled artifact and
//! parsanol's browser engine. No node:* module appears in this graph.
//! The wasm engine loads lazily — the first `nistWorkerGrammarImplementation()`
//! call pays the ~2.7 MB fetch/instantiate; the parse calls stay
//! synchronous after the await.
//!
//!     import { nistWorkerGrammarImplementation } from "@pubid/pubid/dist/flavors/nist/worker.js";
//!     const nist = await nistWorkerGrammarImplementation(wasmOrUrl);
//!     nist.parse("NIST SP 800-53r5");
//!
//! The wasm argument is whatever `parsanol/browser`'s `initialize()`
//! takes: an R2/CDN URL (the lazy fetch path), a CompiledWasm module
//! (wrangler `rules = [{ type = "CompiledWasm", ... }]`), or raw bytes.

import { workerPargRuntime, type WorkerWasmInput } from "../../parg/worker.js";
import type { FlavorImplementation } from "../../conformance/implementation.js";
import { makeNistGrammarImplementation } from "./implementation.js";

export async function nistWorkerGrammarImplementation(
  wasm?: WorkerWasmInput,
): Promise<FlavorImplementation> {
  const runtime = await workerPargRuntime("nist", wasm);
  return makeNistGrammarImplementation({
    parseShape(input: string): unknown {
      return runtime.parseShape(input);
    },
  });
}
