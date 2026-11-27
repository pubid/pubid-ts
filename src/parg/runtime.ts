//! The PARG artifact runtime for pubid: a thin adapter over the
//! published `parsanol` npm package (the wasm engine), adding the
//! pubid-workspace artifacts directory convention. No grammar code and
//! no vendored engine copy live in this repo; the baked artifact is
//! the contract and the engine ships from the registry.
//!
//! Worker-safe (pubid-ts#232): this module imports no node:* module. The
//! artifact comes from the registry (registerArtifact — a worker imports
//! the artifact modules of dist/parg/artifacts/) before the disk; the
//! disk read reaches node:fs through process.getBuiltinModule, so a
//! bundle never sees it. The engine is the "parsanol" import (node: the
//! synchronous node build; a worker/browser bundle resolves the web
//! build), replaceable through setPargEngine (src/worker.ts installs the
//! web engine after its async wasm initialization).

import { PargRuntime as EngineRuntime } from "parsanol";

export type { FieldRequirement, EntrySchema, Schema } from "parsanol";
export { PargRuntime } from "parsanol";

/** A parsanol engine class: the node PargRuntime or the web one. The two
 * share every member but compiledFrom (synchronous in node, a promise
 * on the web engine). */
export type PargEngine = new (artifactJson: string, entry?: string) => Omit<EngineRuntime, "compiledFrom">;

/** Raised when a grammar artifact is neither registered nor readable from disk. */
export class PargArtifactUnavailable extends Error {
  readonly grammar: string;

  constructor(grammar: string, reason: string, options?: { cause?: unknown }) {
    super(`PARG artifact "${grammar}" is unavailable: ${reason}`, options);
    this.name = "PargArtifactUnavailable";
    this.grammar = grammar;
  }
}

const registry = new Map<string, string>();
let engine: PargEngine = EngineRuntime;

/** Register a baked artifact (its raw JSON text, kept verbatim: the
 * engine verifies the checksum over it). A registered artifact wins over
 * the disk. */
export function registerArtifact(grammar: string, artifactJson: string): void {
  registry.set(grammar, artifactJson);
}

/** Register several artifacts, keyed by grammar name. */
export function registerArtifacts(artifacts: Readonly<Record<string, string>>): void {
  for (const [grammar, json] of Object.entries(artifacts)) registerArtifact(grammar, json);
}

/** Replace the engine class every later load constructs. */
export function setPargEngine(cls: PargEngine): void {
  engine = cls;
}

interface NodeBuiltins {
  fs: { existsSync(path: string): boolean; readFileSync(path: string, encoding: "utf8"): string };
  path: { dirname(path: string): string; join(...parts: string[]): string };
  url: { fileURLToPath(url: string): string };
  env: Record<string, string | undefined>;
}

/** The node builtins, reached at call time and never by a static import;
 * undefined outside node (a worker without nodejs_compat). */
function nodeBuiltins(): NodeBuiltins | undefined {
  const proc = (globalThis as {
    process?: { env?: Record<string, string | undefined>; getBuiltinModule?: (id: string) => unknown };
  }).process;
  const get = proc?.getBuiltinModule;
  if (typeof get !== "function") return undefined;
  return {
    fs: get("node:fs") as NodeBuiltins["fs"],
    path: get("node:path") as NodeBuiltins["path"],
    url: get("node:url") as NodeBuiltins["url"],
    env: proc?.env ?? {},
  };
}

function requireNode(): NodeBuiltins {
  const node = nodeBuiltins();
  if (node === undefined) {
    throw new Error("no filesystem here: register the artifact with registerArtifact (see dist/worker.js)");
  }
  return node;
}

/** Walk up from this module to the package root (which holds package.json). */
function packageRoot(node: NodeBuiltins): string {
  const { fs, path, url } = node;
  let dir = path.dirname(url.fileURLToPath(import.meta.url));
  for (; !fs.existsSync(path.join(dir, "package.json")); dir = path.dirname(dir)) {
    if (dir === path.dirname(dir)) throw new Error("package.json not found above the parg runtime");
  }
  return dir;
}

/** The artifacts directory: PARG_ARTIFACT_DIR, else the sibling
 * pubid-grammar checkout of the pubid workspace, else the vendored copy
 * shipped in the published package (refreshed by `npm run artifact`).
 * Node only: it throws where no filesystem exists. */
export function artifactsDir(): string {
  const node = requireNode();
  const env = node.env["PARG_ARTIFACT_DIR"];
  if (env) return env;
  const root = packageRoot(node);
  const sibling = node.path.join(root, "..", "pubid-grammar", "artifacts");
  if (node.fs.existsSync(sibling)) return sibling;
  return node.path.join(root, "vendor", "parg");
}

function artifactJson(grammar: string): string {
  const registered = registry.get(grammar);
  if (registered !== undefined) return registered;
  const node = nodeBuiltins();
  if (node === undefined) {
    throw new PargArtifactUnavailable(grammar, "not registered, and no filesystem to read it from");
  }
  let file = `${grammar}.json`;
  try {
    file = node.path.join(artifactsDir(), file);
    return node.fs.readFileSync(file, "utf8");
  } catch (cause) {
    throw new PargArtifactUnavailable(grammar, `not registered, and ${file} is unreadable`, { cause });
  }
}

/** The pubid flavor runtime: loads baked artifacts from the registry,
 * else from the workspace. */
export class PubidRuntime extends EngineRuntime {
  static artifactsDir(): string {
    return artifactsDir();
  }

  /** Typed as the node engine for compatibility; after setPargEngine
   * the instance is the web engine, whose compiledFrom returns a promise. */
  static load(grammar: string, entry?: string): EngineRuntime {
    return new engine(artifactJson(grammar), entry) as EngineRuntime;
  }
}

/**
 * The artifact emits capture leaves ({value, line, column, offset,
 * length}) and a top-level sequence of capture hashes. This mirrors the
 * gem's Pubid::Parg::Backend.to_builder_hash: scalarize leaves, fold the
 * top-level list into one hash (last key wins — parslet's sequence fold).
 */
export function toBuilderTree(shape: unknown): unknown {
  const normalized = normalizeShape(shape);
  if (Array.isArray(normalized) &&
      normalized.length > 0 &&
      normalized.every((n) => typeof n === "object" && n !== null && !Array.isArray(n))) {
    return Object.assign({}, ...normalized as Record<string, unknown>[]);
  }
  return normalized;
}

/**
 * Strip the shape metadata an artifact parse carries (offset/line/column
 * wrappers) down to the plain string/array capture tree the builders
 * consume — the same tree shape the hand-written grammars produced.
 */
export function normalizeShape(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(normalizeShape);
  if (typeof node === "object" && node !== null) {
    const rec = node as Record<string, unknown>;
    if (typeof rec["value"] === "string" && Object.keys(rec).length >= 1 &&
        "offset" in rec) {
      return rec["value"];
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rec)) out[k] = normalizeShape(v);
    return out;
  }
  return node;
}
