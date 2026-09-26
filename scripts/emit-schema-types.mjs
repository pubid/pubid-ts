// T2: emit static TypeScript types from the artifacts' binding-requirements
// schemas. The runtime stays schema-driven; these files exist for IDEs.
// Usage: node scripts/emit-schema-types.mjs [artifact ...]
//   Reads every artifact in PG_ARTIFACT_DIR (default ../pubid-grammar/artifacts)
//   and writes src/pg/generated/<grammar>.d.ts via the wasm schemaTypescript().

import { readdirSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const wasm = require(createRequire(import.meta.url).resolve("../vendor/parsanol-wasm/parsanol.js"));

const dir = process.env.PG_ARTIFACT_DIR ?? new URL("../../../pubid/pubid-grammar/artifacts", import.meta.url).pathname;
const outDir = new URL("../src/pg/generated/", import.meta.url).pathname;
mkdirSync(outDir, { recursive: true });

const files = process.argv.length > 2
  ? process.argv.slice(2).map((f) => (f.endsWith(".json") ? f : `${f}.json`))
  : readdirSync(dir).filter((f) => f.endsWith(".json"));

let count = 0;
for (const file of files) {
  const text = readFileSync(join(dir, file), "utf8");
  const artifact = new wasm.PgArtifactJs(text); // checksum-verified
  const name = file.replace(/\.json$/, "").replace(/[^a-zA-Z0-9]/g, "_");
  const ts = artifact.schemaTypescript();
  writeFileSync(join(outDir, `${name}.d.ts`), `// Generated from ${file} — do not edit.\n${ts}`);
  count += 1;
}
console.log(`emitted ${count} schema type files to src/pg/generated/`);
