import { readFileSync, existsSync } from "node:fs";
import { gunzipSync } from "node:zlib";
/** Serialize a loaded corpus to the compact artifact JSON string. */
export function buildArtifact(corpus) {
    const data = {};
    for (const [name, payloads] of corpus.flavors) {
        data[name] = {
            status: payloads.status,
            cases: payloads.cases,
            negatives: payloads.negatives,
            debt: payloads.debt,
        };
    }
    return JSON.stringify(data);
}
/** Rebuild the Corpus shape from artifact JSON produced by {@link buildArtifact}. */
export function parseArtifact(json) {
    const data = JSON.parse(json);
    const flavors = new Map();
    for (const [name, flavor] of Object.entries(data)) {
        if (typeof flavor?.status?.clean !== "boolean") {
            throw new Error(`malformed artifact: flavor ${name} has no boolean status.clean`);
        }
        flavors.set(name, {
            status: flavor.status,
            cases: flavor.cases ?? [],
            negatives: flavor.negatives ?? [],
            debt: flavor.debt ?? [],
        });
    }
    if (flavors.size === 0) {
        throw new Error("malformed artifact: no flavors - refusing vacuous success");
    }
    return { flavors };
}
/**
 * Walk up from this module to the directory holding package.json, so the
 * artifact resolves identically from dist/, dist-test/ and src/ builds.
 */
function packageRoot() {
    let dir = new URL(".", import.meta.url);
    for (let i = 0; i < 6; i++) {
        if (existsSync(new URL("package.json", dir)))
            return dir;
        dir = new URL("../", dir);
    }
    throw new Error("package root not found - cannot locate the bundled corpus artifact");
}
/**
 * Load the corpus shipped inside this package (artifact/corpus.json.gz).
 * No testsuite checkout, no yaml dependency at runtime.
 */
export function loadBundledCorpus() {
    const artifactUrl = new URL("artifact/corpus.json.gz", packageRoot());
    const json = gunzipSync(readFileSync(artifactUrl)).toString("utf8");
    return parseArtifact(json);
}
