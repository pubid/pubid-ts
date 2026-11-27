/**
 * The ieee worker entry (pubid-ts#232): the web engine plus the ieee
 * artifact and the ansi artifact (the ANSI-led spellings route to the
 * ansi flavor), with no node:* module in the import graph.
 *
 * ```ts
 * import wasm from "@pubid/pubid/dist/parg/parsanol_bg.wasm";
 * import { ieeeWorkerImplementation } from "@pubid/pubid/dist/flavors/ieee/worker.js";
 * const ieee = await ieeeWorkerImplementation(wasm);
 * ieee.parse("IEEE Std 802.3-2018");
 * ```
 *
 * The ieee module imports the grammar barrel for its co-publisher routing
 * (iec, ansi), so this entry's bundle carries every flavor.
 */
import type { FlavorImplementation } from "../../conformance/implementation.js";
import { initPargEngine, type PargWasm } from "../../worker-engine.js";
import { registerArtifacts } from "../../parg/runtime.js";
import ieeeArtifact from "../../parg/artifacts/ieee.js";
import ansiArtifact from "../../parg/artifacts/ansi.js";
import { withUrnRouting } from "../urn-routing.js";
import { ieeeGrammarImplementation } from "./index.js";

/** Initialize the engine (once), register the ieee and ansi artifacts,
 * and return the ieee implementation with the barrel's URN routing. */
export async function ieeeWorkerImplementation(wasm: PargWasm): Promise<FlavorImplementation> {
  await initPargEngine(wasm);
  registerArtifacts({ ieee: ieeeArtifact, ansi: ansiArtifact });
  return withUrnRouting("ieee", ieeeGrammarImplementation());
}
