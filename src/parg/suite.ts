//! pgtest suite runner: re-exports the engine suite machinery from the
//! published `parsanol` package; only the suites directory convention
//! (sibling pubid-grammar checkout) is pubid-specific.

export {
  loadSuites,
  readSuite,
  runSuite,
  type Suite,
  type SuiteTest,
  type TestKind,
} from "parsanol/suite";
export { PubidRuntime } from "./runtime.js";
import { join } from "node:path";
import { artifactsDir } from "./runtime.js";

/** The suites directory: PARG_SUITES_DIR, else beside the artifacts. */
export function suitesDir(): string {
  const env = process.env.PARG_SUITES_DIR;
  if (env) return env;
  return join(artifactsDir(), "..", "suites");
}
