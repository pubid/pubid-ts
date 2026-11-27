/**
 * The nist worker entry (pubid-ts#232): the web engine plus the nist
 * artifact, with no node:* module in the import graph.
 *
 * ```ts
 * import wasm from "@pubid/pubid/dist/parg/parsanol_bg.wasm";
 * import { nistWorkerImplementation } from "@pubid/pubid/dist/flavors/nist/worker.js";
 * const nist = await nistWorkerImplementation(wasm);
 * nist.parse("NIST SP 800-53r5");
 * ```
 */
import type { FlavorImplementation } from "../../conformance/implementation.js";
import { initPargEngine, type PargWasm } from "../../worker-engine.js";
import { registerArtifact } from "../../parg/runtime.js";
import nistArtifact from "../../parg/artifacts/nist.js";
import { withUrnRouting } from "../urn-routing.js";
import { nistGrammarImplementation } from "./index.js";

/** Initialize the engine (once), register the nist artifact, and return
 * the nist implementation with the barrel's URN routing. */
export async function nistWorkerImplementation(wasm: PargWasm): Promise<FlavorImplementation> {
  await initPargEngine(wasm);
  registerArtifact("nist", nistArtifact);
  return withUrnRouting("nist", nistGrammarImplementation());
}
