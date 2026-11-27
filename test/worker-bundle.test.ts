import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

// The worker entries' bundle check (pubid-ts#232): bundle each entry the
// way wrangler does (the workerd/worker/browser export conditions, no
// node platform) and fail on any node:* import in the result. The
// conditions matter: they resolve "parsanol" to its web build, whose
// graph has no node-only module.

const ENTRIES = [
  "../src/worker.js",
  "../src/flavors/nist/worker.js",
  "../src/flavors/ieee/worker.js",
  "../src/flavors/oiml/index.js",
];

for (const entry of ENTRIES) {
  test(`the ${entry.slice(7)} bundle has no node:* import`, async () => {
    const result = await build({
      entryPoints: [fileURLToPath(new URL(entry, import.meta.url))],
      bundle: true,
      write: false,
      format: "esm",
      platform: "neutral",
      conditions: ["workerd", "worker", "browser"],
      mainFields: ["browser", "module", "main"],
      metafile: true,
      logLevel: "silent",
      // A node:* specifier stays in the output as an import instead of
      // failing the build, so the assertion below can name it.
      external: ["node:*"],
    });
    const nodeImports = Object.entries(result.metafile.inputs).flatMap(([file, input]) =>
      input.imports.filter((i) => i.path.startsWith("node:")).map((i) => `${file} -> ${i.path}`),
    );
    assert.deepEqual(nodeImports, [], "a node-only module is reachable from the worker entry");
    const inputs = Object.keys(result.metafile.inputs);
    assert.ok(
      !inputs.some((f) => f.includes("parsanol/dist/runtime.js")),
      "parsanol must resolve to its web build, not the node runtime",
    );
  });
}
