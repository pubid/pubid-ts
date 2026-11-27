#!/usr/bin/env node
// Emits the worker-safe artifact modules (pubid/pubid-ts#232): each
// bundled grammar's baked artifact JSON becomes a default-exported
// string under src/parg/artifacts/, imported by the per-flavor worker
// entries. The artifact text is the SAME checksummed payload the node
// path loads from vendor/parg — one source of truth, two load paths.
// Regenerate with `npm run artifact` (refreshes vendor/parg from the
// pubid-grammar checkout, then re-emits these modules) or standalone
// with `npm run artifact:emit`.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "src", "parg", "artifacts");
mkdirSync(outDir, { recursive: true });

const grammars = process.argv.slice(2).length > 0 ? process.argv.slice(2) : ["nist", "ieee"];

for (const grammar of grammars) {
  const json = readFileSync(join(root, "vendor", "parg", `${grammar}.json`), "utf8");
  const ts = [
    "//! GENERATED FILE — do not edit. The checksummed PARG artifact for",
    `//! the ${grammar} grammar, bundled as a module string so the worker`,
    "//! entries can construct the runtime without node:fs",
    "//! (pubid/pubid-ts#232). Regenerate with `npm run artifact:emit`.",
    "",
    `export default ${JSON.stringify(json)};`,
    "",
  ].join("\n");
  writeFileSync(join(outDir, `${grammar}.ts`), ts);
  console.log(`artifact:emit ${grammar} (${(json.length / 1024).toFixed(0)} KB)`);
}
