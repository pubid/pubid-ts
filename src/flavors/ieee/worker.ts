//! The worker entry for the ieee flavor (pubid/pubid-ts#232): the same
//! implementation the node entry runs, over the bundled artifact and
//! parsanol's browser engine. No node:* module appears in this graph.
//! The wasm engine loads lazily — the first
//! `ieeeWorkerGrammarImplementation()` call pays the ~2.7 MB
//! fetch/instantiate; the parse calls stay synchronous after the await.
//!
//! Co-published routing: the iec side goes through the parg-free iec
//! implementation (pure parslet, worker-safe). The ansi side has no
//! worker implementation yet — adopted-standard ids carrying an ANSI
//! part reject with the same "ANSI implementation unavailable" the node
//! router produces for an unknown flavor. A consumer that ships an ansi
//! implementation can inject it via `coPublished`.
//!
//!     import { ieeeWorkerGrammarImplementation } from "@pubid/pubid/dist/flavors/ieee/worker.js";
//!     const ieee = await ieeeWorkerGrammarImplementation(wasmOrUrl);
//!     ieee.parse("IEEE Std 802.3-2022");

import { workerPargRuntime, type WorkerWasmInput } from "../../parg/worker.js";
import type { FlavorImplementation } from "../../conformance/implementation.js";
import { iecGrammarImplementation } from "../iec/index.js";
import {
  makeIeeeGrammarImplementation,
  makeIeeeParseEngine,
} from "./implementation.js";

export async function ieeeWorkerGrammarImplementation(options?: {
  wasm?: WorkerWasmInput;
  /** Override the co-published side resolver (default: iec only). */
  coPublished?: (flavor: string) => FlavorImplementation | undefined;
}): Promise<FlavorImplementation> {
  const runtime = await workerPargRuntime("ieee", options?.wasm);
  const coPublished =
    options?.coPublished ??
    ((flavor: string) => (flavor === "iec" ? iecGrammarImplementation() : undefined));
  return makeIeeeGrammarImplementation(
    makeIeeeParseEngine({
      parseAndBind(input: string): unknown {
        return runtime.parseAndBind(input);
      },
      coPublished,
    }),
  );
}
