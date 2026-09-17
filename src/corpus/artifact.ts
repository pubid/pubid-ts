import { readFileSync, existsSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import type { Corpus, FlavorPayloads } from "./loader.js";
import type { CorpusCase, FlavorStatus } from "./types.js";

/**
 * The prebuilt corpus artifact: the whole testsuite corpus, serialized
 * and gzipped, shipped inside the package. This is the zero-checkout
 * path of pubid-ts#1 finding 5 - `loadBundledCorpus()` needs neither a
 * pubid-testsuite checkout on disk nor the `yaml` dependency at
 * runtime, so the library works in any Node runtime that has the
 * package installed. Regenerate with `npm run artifact` after a corpus
 * pin bump.
 */

interface ArtifactFlavor {
  status: FlavorStatus;
  cases: CorpusCase[];
  negatives: CorpusCase[];
  debt: CorpusCase[];
}

type ArtifactData = Record<string, ArtifactFlavor>;

/** Serialize a loaded corpus to the compact artifact JSON string. */
export function buildArtifact(corpus: Corpus): string {
  const data: ArtifactData = {};
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
export function parseArtifact(json: string): Corpus {
  const data = JSON.parse(json) as ArtifactData;
  const flavors = new Map<string, FlavorPayloads>();
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
function packageRoot(): URL {
  let dir = new URL(".", import.meta.url);
  for (let i = 0; i < 6; i++) {
    if (existsSync(new URL("package.json", dir))) return dir;
    dir = new URL("../", dir);
  }
  throw new Error("package root not found - cannot locate the bundled corpus artifact");
}

/**
 * Load the corpus shipped inside this package (artifact/corpus.json.gz).
 * No testsuite checkout, no yaml dependency at runtime.
 */
export function loadBundledCorpus(): Corpus {
  const artifactUrl = new URL("artifact/corpus.json.gz", packageRoot());
  const json = gunzipSync(readFileSync(artifactUrl)).toString("utf8");
  return parseArtifact(json);
}
