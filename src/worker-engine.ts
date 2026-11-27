/**
 * The web-engine initialization the worker entries share (pubid-ts#232),
 * apart from src/worker.ts so a per-flavor entry does not import the
 * grammar barrel.
 */
import initialize, { PargRuntime as WebPargRuntime } from "parsanol/browser";
import { setPargEngine } from "./parg/runtime.js";

/** The wasm the web engine takes: a compiled module (a worker's wasm
 * import) or the raw bytes. */
export type PargWasm = WebAssembly.Module | BufferSource;

let ready: Promise<void> | undefined;

/**
 * Initialize parsanol's web engine from `wasm` and make it the engine of
 * every later artifact load. Idempotent: later calls return the first
 * call's promise (and ignore their argument). A failed init is not
 * cached, so the next call retries.
 */
export function initPargEngine(wasm: PargWasm): Promise<void> {
  ready ??= initialize(wasm).then(
    () => setPargEngine(WebPargRuntime),
    (error: unknown) => {
      ready = undefined;
      throw error;
    },
  );
  return ready;
}
