import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
// The worker entries — loading them in a worker is pubid-ts#232's
// deliverable; these checks pin the property that makes it possible:
// no node:* module anywhere in their import graphs.
import { build } from "esbuild";

// The compiled-tree closure of a module: relative specifiers resolve
// and recurse; bare specifiers are collected as externals.
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

function distTestSrc(path: string): URL {
  return new URL(`../src/${path}`, import.meta.url);
}

const WORKER_ENTRIES = [
  "flavors/nist/worker.js",
  "flavors/ieee/worker.js",
  "flavors/oiml/worker.js",
  // The shared-builder family (pubid-ts#236): pure-TS parslet ports
  // over the worker-safe foreign resolver — no engine at all.
  "flavors/bsi/worker.js",
  "flavors/cen_cenelec/worker.js",
  "flavors/csa/worker.js",
  "flavors/gost/worker.js",
  "flavors/evs/worker.js",
];

// The entries that need no wasm engine: the pure-TS parslet ports
// (oiml and the shared-builder family). Their graph is relative-only.
const PURE_ENTRIES = WORKER_ENTRIES.filter((entry) =>
  /^(flavors\/(oiml|bsi|cen_cenelec|csa|gost|evs)\/worker\.js)$/.test(entry),
);

test("the worker entries' import graphs carry no node module", () => {
  for (const entry of WORKER_ENTRIES) {
    const { externals } = walk(distTestSrc(entry));
    const nodeSpecs = [...externals].filter((spec) => spec.startsWith("node:"));
    assert.deepEqual(
      nodeSpecs,
      [],
      `${entry} must not reach any node:* module`,
    );
    // The only allowed bare specifier is parsanol's browser engine (the
    // parg entries ride it; the pure-TS parslet ports need no engine at
    // all).
    const allowed = PURE_ENTRIES.includes(entry) ? [] : ["parsanol/browser"];
    assert.deepEqual(
      [...externals].sort(),
      allowed,
      `${entry} must not drag package dependencies beyond parsanol/browser`,
    );
  }
});

test("the worker entries never reach the fs-backed runtime module", () => {
  for (const entry of WORKER_ENTRIES) {
    const { modules } = walk(distTestSrc(entry));
    const tainted = modules.filter((url) => /\/parg\/runtime\.js$/.test(url.pathname));
    assert.deepEqual(
      tainted.map((url) => url.pathname),
      [],
      `${entry} must not import src/parg/runtime.js (the node:fs loader)`,
    );
  }
});

test("the node entries keep the fs path (the split is additive)", () => {
  for (const entry of ["flavors/nist/index.js", "flavors/ieee/index.js"]) {
    const { externals } = walk(distTestSrc(entry));
    assert.ok(
      externals.has("node:fs"),
      `${entry} must keep loading the artifact from disk for node consumers`,
    );
  }
});

test("the bundled artifact modules match the vendored payloads", () => {
  // One source of truth: the generated src/parg/artifacts/*.ts strings
  // must be byte-identical to vendor/parg/*.json — the same checksummed
  // payloads the node path reads from disk. Stale bundles fail here the
  // same way the api-reference drift gate does; regenerate with
  // `npm run artifact:emit`.
  for (const grammar of ["nist", "ieee"]) {
    const bundled = readFileSync(
      new URL(`../src/parg/artifacts/${grammar}.js`, import.meta.url),
      "utf8",
    );
    const vendored = readFileSync(
      new URL(`../../vendor/parg/${grammar}.json`, import.meta.url),
      "utf8",
    );
    // The export line is matched line-wise (not with a `.` regex over
    // the whole file): the artifact JSON carries U+2028/U+2029 line
    // separators, which `.` never matches.
    const line = bundled.split("\n").find((l) => l.startsWith("export default "));
    assert.ok(line, `${grammar}.js must be a single default-exported string`);
    assert.ok(line.endsWith('";'), `${grammar}.js must be a single default-exported string`);
    assert.equal(
      JSON.parse(line.replace(/^export default /, "").replace(/;$/, "")),
      vendored,
      `${grammar}'s bundled artifact drifted from vendor/parg`,
    );
  }
});

test("the worker entries bundle with esbuild --platform=neutral (no node externals)", async () => {
  for (const entry of WORKER_ENTRIES) {
    // platform=neutral has no node built-in resolver: any node:* import
    // in the graph fails the build, so a clean build IS the bundle
    // check (the issue's acceptance bar).
    const result = await build({
      entryPoints: [new URL(`../src/${entry}`, import.meta.url).pathname],
      platform: "neutral",
      format: "esm",
      bundle: true,
      write: false,
      logLevel: "silent",
    });
    const output = result.outputFiles.map((f) => f.text).join("");
    assert.ok(output.length > 0, `${entry} must bundle to output`);
    assert.ok(
      !/["']node:[a-z]+["']/.test(output),
      `${entry}'s neutral bundle must contain no node: specifier`,
    );
  }
});
