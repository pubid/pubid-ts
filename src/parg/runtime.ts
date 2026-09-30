//! The PARG artifact runtime for pubid: a thin adapter over the
//! published `parsanol` npm package (the wasm engine), adding the
//! pubid-workspace artifacts directory convention. No grammar code and
//! no vendored engine copy live in this repo; the baked artifact is
//! the contract and the engine ships from the registry.

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PargRuntime as EngineRuntime } from "parsanol";

export type { FieldRequirement, EntrySchema, Schema } from "parsanol";
export { PargRuntime } from "parsanol";

/** Walk up from this module to the package root (which holds package.json). */
function packageRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (; !existsSync(join(dir, "package.json")); dir = dirname(dir)) {
    if (dir === dirname(dir)) throw new Error("package.json not found above the parg runtime");
  }
  return dir;
}

/** The artifacts directory: PARG_ARTIFACT_DIR, else the sibling
 * pubid-grammar checkout of the pubid workspace. */
export function artifactsDir(): string {
  const env = process.env.PARG_ARTIFACT_DIR;
  if (env) return env;
  return join(packageRoot(), "..", "pubid-grammar", "artifacts");
}

/** The pubid flavor runtime: loads baked artifacts from the workspace. */
export class PubidRuntime extends EngineRuntime {
  static artifactsDir(): string {
    return artifactsDir();
  }

  static load(grammar: string, entry?: string): EngineRuntime {
    return EngineRuntime.fromFile(join(artifactsDir(), `${grammar}.json`), entry);
  }
}
