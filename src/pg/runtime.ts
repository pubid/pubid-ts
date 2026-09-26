//! PG artifact runtime for TypeScript (TODO 12 / T1): checksum-verified
//! artifact load, native wasm parse, bindings application, and
//! schema-driven materialization. The engine is the vendored
//! parsanol wasm package (PgArtifactJs, C9) — no grammar code lives in
//! this repo; the artifact is the contract.

import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PgArtifactJs = any;

interface WasmModule {
  PgArtifactJs: new (artifactJson: string) => PgArtifactJs;
}

/** Walk up from this module to the package root (which holds package.json). */
function packageRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (; !existsSync(join(dir, "package.json")); dir = dirname(dir)) {
    if (dir === dirname(dir)) throw new Error("package.json not found above pg runtime");
  }
  return dir;
}

// The vendored wasm glue is CommonJS and lives outside the compiled tree,
// so resolve it against the package root at runtime.
const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-var-requires
const wasm: WasmModule = require(
  join(packageRoot(), "vendor", "parsanol-wasm", "parsanol.js"),
);

/** A field requirement from the binding-requirements schema. */
export interface FieldRequirement {
  type: string;
  card: string;
  preprocess?: string;
}

/** The binding-requirements schema record for one entry. */
export interface EntrySchema {
  root: string;
  fields: Record<string, FieldRequirement>;
  examples: { input: string; captures: Record<string, unknown> }[];
}

export type Schema = Record<string, EntrySchema>;

/**
 * A loaded, checksum-verified PG artifact with its schema.
 * Construction throws when the checksum does not verify.
 */
export class PgRuntime {
  readonly artifact: PgArtifactJs;
  readonly schema: Schema;
  readonly entry: string;

  constructor(artifactJson: string, entry?: string) {
    this.artifact = new wasm.PgArtifactJs(artifactJson);
    this.schema = JSON.parse(this.artifact.schema()) as Schema;
    this.entry = entry ?? this.artifact.entryNames()[0];
  }

  /** Load an artifact JSON file and verify its checksum. */
  static fromFile(path: string, entry?: string): PgRuntime {
    return new PgRuntime(readFileSync(path, "utf8"), entry);
  }

  /** The default artifacts directory (the pubid-grammar checkout). */
  static artifactsDir(): string {
    const env = process.env.PG_ARTIFACT_DIR;
    if (env) return env;
    // pubid-grammar is a sibling checkout in the pubid workspace.
    return join(packageRoot(), "..", "pubid-grammar", "artifacts");
  }

  static load(grammar: string, entry?: string): PgRuntime {
    return PgRuntime.fromFile(join(PgRuntime.artifactsDir(), `${grammar}.json`), entry);
  }

  /** Parse with the native wasm engine; returns the parsanol-shape tree. */
  parseShape(input: string): unknown {
    return JSON.parse(this.artifact.parseShape(this.entry, input));
  }

  /** Apply the entry's bindings to a parsanol-shape tree. */
  applyBindings(shape: unknown): Record<string, unknown> {
    return JSON.parse(this.artifact.applyBindings(this.entry, JSON.stringify(shape)));
  }

  /** Parse and bind in one step. */
  parseAndBind(input: string): Record<string, unknown> | null {
    try {
      return JSON.parse(this.artifact.parseAndBind(this.entry, input));
    } catch {
      return null;
    }
  }

  /**
   * Schema-driven materialization: the schema (from the artifact, not
   * hand-written model code) declares the fields a data model must
   * implement; the bound captures populate a structurally-typed object.
   * Card `1*`/`*` fields become arrays; `0..1` fields become nullable.
   */
  materialize(input: string): Materialized | null {
    const bound = this.parseAndBind(input);
    if (bound === null) return null;
    const schema = this.schema[this.entry];
    if (!schema) throw new Error(`artifact has no schema for entry ${this.entry}`);
    return materializeFromSchema(schema, bound);
  }

  /** Run the artifact's embedded tests; empty list means green. */
  runTests(): string[] {
    return JSON.parse(this.artifact.runTests()) as string[];
  }
}

/** A schema-materialized identifier: typed fields plus provenance. */
export interface Materialized {
  entry: string;
  attributes: Record<string, unknown>;
}

/**
 * Schema-driven materialization independent of any wasm handle —
 * the same function the model layer will build on (T2 codegen emits the
 * static view of exactly these fields).
 */
export function materializeFromSchema(
  schema: EntrySchema,
  bound: Record<string, unknown>,
): Materialized {
  const attributes: Record<string, unknown> = {};
  for (const [path, requirements] of Object.entries(schema.fields)) {
    const leaf = path.includes("[]")
      ? (path.split("].").pop() ?? path)
      : path;
    const value = bound[leaf];
    if (requirements.card.endsWith("*")) {
      const list = Array.isArray(value) ? value : value === undefined ? [] : [value];
      attributes[leaf] = list;
    } else if (requirements.card === "0..1") {
      attributes[leaf] = value === undefined ? null : value;
    } else {
      attributes[leaf] = value;
    }
  }
  return { entry: schema.root, attributes };
}
