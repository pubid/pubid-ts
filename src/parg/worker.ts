//! The worker-side PARG engine (pubid/pubid-ts#232): the baked
//! artifacts ship as bundled module strings (src/parg/artifacts/,
//! generated from vendor/parg by `npm run artifact:emit`) and the
//! engine is parsanol's browser build — no node:fs anywhere in this
//! graph. The wasm is loaded lazily on the first runtime request: a
//! flavor that never parses in a worker never pays the ~2.4 MB engine
//! cost. `initialize()` fetches the wasm per parsanol/browser's
//! bundler contract (the glue resolves `parsanol_bg.wasm` beside
//! itself); Workers bundles pass a CompiledWasm module or a URL
//! instead via the `wasm` argument.

import { initialize, PargRuntime } from "parsanol/browser";
import nistArtifact from "./artifacts/nist.js";
import ieeeArtifact from "./artifacts/ieee.js";

// parsanol/browser does not re-export the glue's InitInput union; the
// parameter type rides on the initialize signature itself.
export type WorkerWasmInput = Parameters<typeof initialize>[0];

const bundledArtifacts: Record<string, string> = {
  nist: nistArtifact,
  ieee: ieeeArtifact,
};

export type WorkerPargGrammar = keyof typeof bundledArtifacts;

let enginePromise: Promise<void> | undefined;

/** Initialize the browser engine once per isolate (the lazy ~2.4 MB wasm). */
export function initWorkerEngine(wasm?: WorkerWasmInput): Promise<void> {
  enginePromise ??= initialize(wasm);
  return enginePromise;
}

/** The artifact-backed runtime for one grammar over the browser engine. */
export async function workerPargRuntime(
  grammar: WorkerPargGrammar,
  wasm?: WorkerWasmInput,
): Promise<PargRuntime> {
  await initWorkerEngine(wasm);
  const artifact = bundledArtifacts[grammar];
  if (artifact === undefined) {
    throw new Error(`no bundled PARG artifact for "${grammar}" (worker graph, pubid-ts#232)`);
  }
  return new PargRuntime(artifact);
}

export { PargRuntime as WorkerPargRuntime };
