import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import type { CorpusCase, FlavorStatus } from "./types.js";

/**
 * The corpus files are written by the ruby exporter's psych dump, so
 * their wire form carries YAML 1.1 scalar resolution: psych keeps
 * exponent spellings without a dot (`102E-42`, `45E-36`) as Strings,
 * while the npm yaml package's 1.2 core schema floats them — the
 * divergence behind pubid-ts#177. Loading the corpus is the boundary
 * where the parse type is decided, so the loader reads it back under
 * psych's float contract instead of patching serialization per site:
 * a float needs the dot, and where psych keeps a String the loader
 * keeps the String too. Other 1.1-vs-1.2 classes (legacy octal
 * `0777`, `yes`-bool) never occur in the corpus and are left on the
 * package default.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the yaml
// package's Tags union makes a discriminating map awkward; the shapes
// below are the package's own ScalarTag objects with test/resolve swapped.
const psychFloatTags = (tags: any[]): any[] =>
  tags.map((tag: any) => {
    if (tag?.tag !== "tag:yaml.org,2002:float") return tag;
    const source = String(tag.test?.source);
    if (source.includes("inf")) return tag; // floatNaN: .inf/.nan as psych has them
    if (tag.format === "EXP") {
      // The exponent form: psych requires the dot AND the exponent sign
      // (`1.0E-5` floats; `102E-42`, `1.5e3` stay Strings).
      return {
        ...tag,
        test: /^[-+]?(?:[0-9][0-9_]*)?\.[0-9_]*[eE][-+][0-9]+$/,
        resolve: (str: string) => parseFloat(str.replace(/_/g, "")),
      };
    }
    // The decimal form: dot required (psych accepts a bare `.5`, an
    // optional fraction `1.`, and `1_000.5`-style underscores).
    return {
      ...tag,
      test: /^[-+]?(?:[0-9][0-9_]*)?\.[0-9_]*$/,
      resolve: (str: string) => parseFloat(str.replace(/_/g, "")),
    };
  });

/** Parse corpus YAML under the psych wire contract (see above). */
export function parseCorpusYaml(text: string): unknown {
  return parseYaml(text, { customTags: psychFloatTags as never });
}

export interface FlavorPayloads {
  /** Non-underscore payload files: canonical cases + aliases. */
  cases: CorpusCase[];
  /** tests/{flavor}/_negative.yaml - fail fixtures decoded by the exporter. */
  negatives: CorpusCase[];
  /** tests/{flavor}/_debt.yaml - pass lines the reference cannot parse. */
  debt: CorpusCase[];
  status: FlavorStatus;
}

export interface Corpus {
  flavors: Map<string, FlavorPayloads>;
}

/**
 * The wire schema uses snake_case for exactly one field
 * (non_normalized_aliases); the loader is the boundary that normalises
 * it, so a missed mapping can never silently disable a check.
 */
function loadPayload(path: string): CorpusCase[] {
  const doc = parseCorpusYaml(readFileSync(path, "utf8"));
  if (!Array.isArray(doc)) return [];
  return doc.map((row) => {
    const raw = row as Record<string, unknown> & { non_normalized_aliases?: unknown };
    if (raw.non_normalized_aliases === undefined) return row as CorpusCase;

    const { non_normalized_aliases, ...rest } = raw;
    return {
      ...(rest as object),
      nonNormalizedAliases: non_normalized_aliases,
    } as CorpusCase;
  });
}

function loadStatus(dir: string): FlavorStatus {
  const path = join(dir, "_status.yaml");
  if (!existsSync(path)) {
    throw new Error(`missing _status.yaml in ${dir} - every flavor has one`);
  }
  const doc = parseCorpusYaml(readFileSync(path, "utf8")) as FlavorStatus;
  if (typeof doc.clean !== "boolean") {
    throw new Error(`malformed _status.yaml in ${dir}: clean must be boolean`);
  }
  return doc;
}

/**
 * Load the pubid-testsuite corpus. The corpus is the single source of
 * truth for identifier behavior; this loader never edits it (the
 * cross-repo law: schema/corpus changes land in pubid Ruby PRs first).
 *
 * @param testsDir path to a pubid-testsuite checkout's tests/ directory
 */
export function loadCorpus(testsDir: string): Corpus {
  if (!existsSync(testsDir)) {
    throw new Error(`corpus not found at ${testsDir} - refusing to report vacuous success`);
  }
  const flavors = new Map<string, FlavorPayloads>();
  for (const entry of readdirSync(testsDir).sort()) {
    const dir = join(testsDir, entry);
    if (!statSync(dir).isDirectory()) continue;

    const payloads: FlavorPayloads = {
      cases: [],
      negatives: [],
      debt: [],
      status: loadStatus(dir),
    };
    for (const file of readdirSync(dir).sort()) {
      if (!file.endsWith(".yaml")) continue;

      const rows = loadPayload(join(dir, file));
      if (file === "_negative.yaml") payloads.negatives = rows;
      else if (file === "_debt.yaml") payloads.debt = rows;
      else if (!file.startsWith("_")) payloads.cases.push(...rows);
    }
    flavors.set(entry, payloads);
  }
  if (flavors.size === 0) {
    throw new Error(`no flavor payloads under ${testsDir} - refusing to report vacuous success`);
  }
  return { flavors };
}
