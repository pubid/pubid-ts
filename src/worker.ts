/**
 * The worker entry for the artifact-backed flavors (pubid-ts#232).
 *
 * Twelve flavors parse through a baked PARG artifact on the parsanol
 * wasm engine (see {@linkcode PARG_GRAMMARS}). In node the engine loads
 * its wasm and the artifacts from disk. A worker has no disk, so the
 * consumer hands both over:
 *
 * ```ts
 * import { initPargEngine, registerArtifact, grammarImplementation } from "@pubid/pubid/dist/worker.js";
 * import wasm from "@pubid/pubid/dist/parg/parsanol_bg.wasm";
 * import nist from "@pubid/pubid/dist/parg/artifacts/nist.js";
 *
 * await initPargEngine(wasm); // once, on the first artifact-flavor parse
 * registerArtifact("nist", nist);
 * grammarImplementation("nist")!.parse("NIST SP 800-53r5");
 * ```
 *
 * The per-flavor entries (dist/flavors/nist/worker.js,
 * dist/flavors/ieee/worker.js) do the init and the registration in one
 * call. No module in this entry's graph imports a node:* module (the
 * bundle check is test/worker-bundle.test.ts).
 */
export { initPargEngine, type PargWasm } from "./worker-engine.js";
export { PARG_GRAMMARS } from "./parg/artifacts/index.js";
export {
  PargArtifactUnavailable,
  registerArtifact,
  registerArtifacts,
} from "./parg/runtime.js";
export { grammarImplementation } from "./flavors/index.js";
