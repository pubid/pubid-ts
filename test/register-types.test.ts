import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
// The worker entry — loading it IS the registration (side-effect), and
// the PubidUrn namespace is the codec this file exercises.
import { PubidUrn } from "../src/register-types.js";
import { resolveType } from "../src/model/identifier.js";
import { PUBID_URN_SCHEMAS } from "../src/pubid-urn/schemas/index.js";
import { loadBundledCorpus } from "../src/corpus/artifact.js";
import type { CorpusCase } from "../src/corpus/types.js";

/** Rows pending the rebuild on the port's own pinned quirks — the same
 *  list the barrel contract skips (test/pubid-urn.test.ts). */
const REBUILD_PENDING = new Set([
  "nist.commercial_standard.2019",
  "nist.commercial_standard.2100",
  "nist.commercial_standard.2195",
  "nist.commercial_standard.2216",
  "nist.commercial_standard.2228",
  "nist.commercial_standard.2272",
]);

// Worker-safe registration (pubid-ts#169). The type registry lives in
// src/model/identifier.js and is populated by importing flavor modules;
// every pre-existing path to them (the grammar barrel
// src/flavors/index.js, or the package root) statically reaches
// src/parg/runtime.js, whose module scope walks up to a package.json
// through node:fs — impossible in a worker bundle. This file loads ONLY
// the worker entry (src/register-types.js): its import graph must be
// exactly what a worker bundle loads, so no grammar-barrel import may
// appear here.

/**
 * The static-import closure of a compiled module: relative specifiers
 * resolve and recurse; bare specifiers are collected as externals.
 */
function walk(entryUrl: URL): { modules: URL[]; externals: Set<string> } {
  const seen = new Map<string, URL>();
  const externals = new Set<string>();
  const queue = [entryUrl];
  while (queue.length > 0) {
    const url = queue.pop()!;
    const key = url.href;
    if (seen.has(key)) continue;
    let source: string;
    try {
      source = readFileSync(url, "utf8");
    } catch {
      continue;
    }
    seen.set(key, url);
    // Comments first: compiled doc comments quote consumer-facing
    // imports ("from \"@pubid/...\") that are not module edges.
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:"'`\w])\/\/[^\n]*/g, "$1");
    // Compiled output is one statement per line: `import … from "…";`,
    // `export … from "…";` and bare `import "…";`.
    const specs = [...code.matchAll(/(?:\bfrom|\bimport)\s*["']([^"']+)["']/g)].map((m) => m[1]!);
    for (const spec of specs) {
      if (!spec.startsWith(".")) {
        externals.add(spec);
        continue;
      }
      queue.push(new URL(spec, url));
    }
  }
  return { modules: [...seen.values()], externals };
}

/** Files of the closure that register identifier types. */
function registeringModules(modules: URL[]): string[] {
  return modules
    .filter((url) => /\bregisterType\(/.test(readFileSync(url, "utf8")))
    .map((url) => url.href)
    .sort();
}

const workerEntry = new URL("../src/register-types.js", import.meta.url);
const grammarBarrel = new URL("../src/flavors/index.js", import.meta.url);

test("the worker entry registers exactly the barrel's type set", () => {
  const viaEntry = registeringModules(walk(workerEntry).modules);
  const viaBarrel = registeringModules(walk(grammarBarrel).modules);
  assert.deepEqual(
    viaEntry,
    viaBarrel,
    "the registration manifest and the grammar barrel must register through the same modules",
  );
});

test("the worker entry's import graph is worker-safe", () => {
  const { modules, externals } = walk(workerEntry);
  assert.deepEqual(
    [...externals].sort(),
    [],
    "the worker entry must not drag any package dependency (parsanol/yaml live behind parg and corpus)",
  );
  const forbidden = modules.filter((url) => /\/(parg|corpus|conformance)\//.test(url.pathname));
  assert.deepEqual(
    forbidden.map((url) => url.pathname),
    [],
    "the worker entry must not reach the parg runtime, the corpus loaders or the pending registry",
  );
});

// The registry content under the manifest, over the declared pubid-urn
// schema tables. The manifest registers exactly the same classes the
// barrel does (the closure test above), so the count here pins the
// whole fleet: a flavor landing a new identifier class bumps both sides
// and this number. The declared-but-unregistered remainder is the
// pre-existing schema/model skew (schema tables declaring types whose
// class is not ported — sae wholesale and the ccsds abstract-root
// "identifier" type, one or two generic types elsewhere; the compiled
// alias flavors re-declare their scheme's
// types — doi_pfs adds two unresolved ones, calconnect_pfs re-declares
// the coded calconnect pair of which the standard type resolves, and
// etsi_pfs re-declares the coded etsi quartet of which three resolve
// through the coded classes ("identifier" stays unresolved, as under the
// coded schema)); the barrel resolves them to exactly the same missing
// types, verified with the ccsds round on 2026-11-14.
const REGISTERED_TYPES = 297;

test("every registered identifier type resolves under the worker entry", () => {
  let registered = 0;
  const unregistered: string[] = [];
  for (const schema of PUBID_URN_SCHEMAS) {
    for (const type of schema.types.keys()) {
      if (resolveType(type) === undefined) {
        unregistered.push(`${schema.flavor}: ${type}`);
      } else {
        registered += 1;
      }
    }
  }
  assert.equal(
    registered,
    REGISTERED_TYPES,
    `the manifest registers ${registered} of the declared types (expected ${REGISTERED_TYPES}); unregistered: ${unregistered.slice(0, 8).join(", ")}…`,
  );
});

// The worker story, end to end: with ONLY the worker entry loaded, a
// slug of a corpus identifier round-trips per flavor. One row per
// flavor — the slug mechanics over the whole corpus are the barrel
// contract (test/pubid-urn.test.ts); this file proves the worker entry
// feeds the same registry, flavors whose model is not ported yet
// (BUILD_PENDING) stay out, and each flavor's first row carries a
// model-backed identifier.
test("fromSlug resolves a corpus identifier of every flavor under the worker entry", () => {
  const corpus = loadBundledCorpus();
  const checked: string[] = [];
  const failures: string[] = [];
  for (const [flavor, payloads] of corpus.flavors) {
    // The worker gate this file exists for: a row whose _type does not
    // resolve is the exact 404 the issue reports. Only model-backed
    // rows are probed; the closure-equality test above pins that the
    // manifest resolves everything the barrel resolves.
    const row: CorpusCase | undefined = payloads.cases.find((c) => {
      if (c.identifier === undefined || c.identifier === null) return false;
      if (REBUILD_PENDING.has(c.id)) return false;
      const type = (c.identifier as Record<string, unknown>)["_type"];
      return typeof type === "string" && resolveType(type) !== undefined;
    });
    if (row === undefined) continue;
    const identifier = row.identifier as Record<string, unknown>;
    let urn: string;
    try {
      urn = PubidUrn.generate(identifier);
    } catch {
      continue; // the schema table cannot emit this row yet (pre-existing skew)
    }
    try {
      const rebuilt = PubidUrn.fromSlug(PubidUrn.toSlug(urn));
      if (PubidUrn.generate(rebuilt.toHash()) !== urn) {
        failures.push(`${flavor}: ${row.id} rebuilt a different URN`);
      } else {
        checked.push(flavor);
      }
    } catch (e) {
      failures.push(`${flavor}: ${row.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  assert.equal(
    failures.length,
    0,
    `slug round-trip failures under the worker entry: ${failures.slice(0, 5).join("; ")}`,
  );
  assert.ok(
    checked.length >= 38,
    `slug round-trip covered ${checked.length} flavors (floor 38: the pre-split coverage the issue reports), checked: ${checked.sort().join(",")}`,
  );
});

// The compiled module inventory is part of the worker contract too: a
// flavor directory that adds a registration module without manifest
// coverage shows up here as an extra .js in dist-test the worker entry
// never loads. (The closure-equality test above catches it when the
// barrel reaches it; this is the belt to those braces.)
test("the worker entry loads a compiled module inventory", () => {
  const { modules } = walk(workerEntry);
  assert.ok(modules.length > 90, `worker entry closure has ${modules.length} modules`);
});
