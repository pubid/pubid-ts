# pubid

The TypeScript implementation of PubID identifiers, conforming to the
[pubid-testsuite](https://github.com/pubid/pubid-testsuite) corpus.

pubid (Ruby) is the reference implementation; this package mirrors it.
The shared artifacts — the YAML schema and the conformance corpus — are
consumed here at a **pinned ref** and are never edited from this repo.

## Cross-repo law

1. Schema and corpus changes **always** land in pubid (Ruby) via PR
   first; pubid-ts then bumps its pinned `TESTSUITE_REF`.
2. The conformance runner mirrors the Ruby quadrants exactly:
   - **pass** — case's canonical hash, human form, URN, aliases and
     deserialize idempotency all match;
   - **FAIL** — a clean-flavor case that does not; breaks CI;
   - **pending** — cases this port explicitly cannot handle yet
     (`conformance/pending.yaml`, same format as Ruby's; a passing
     pending case raises the pending-satisfied alarm);
   - **review** — the expectation itself is flagged for human ruling;
     reported, never gated.
   - Dirty flavors report as the ledger, mirroring `_status.yaml`.
3. An absent or empty corpus is refused — never a vacuous pass.

## Status

**All 46 flavors supported in corpus mode.** The pubid-testsuite corpus is
a **closed universe**: every canonical spelling, canonical hash and URN,
plus every attested non-normalized alias. pubid-ts resolves and normalizes
any identifier IN that universe, and nothing outside it:

```ts
import { loadBundledCorpus, corpusModeImplementation } from "@pubid/pubid";

// Zero-checkout path: the corpus ships inside the package (a 1.7 MB
// gzipped artifact), so there is no testsuite directory to vendor and
// no yaml dependency at runtime.
const corpus = loadBundledCorpus();
const oiml = corpusModeImplementation(corpus.flavors.get("oiml")!.cases);
const id = oiml.parse("…");       // rejects spellings outside the corpus
id.toHuman(); id.toUrn();         // canonical forms
id.toHash();                      // canonical serialized record
id.fromHash(id.toHash());         // idempotent deserialization
oiml.parse(id.toUrn()!);          // URNs are indexed (round-trips)
```

A filesystem checkout is still the source of truth for conformance runs:
`loadCorpus("path/to/pubid-testsuite/tests")` reads the testsuite
directly (that path pulls `yaml` and is Node-only). After a corpus pin
bump, regenerate the bundled artifact with `npm run artifact
TESTSUITE_DIR=…` and commit the result together with the `TESTSUITE_REF`
bump.

Lookup is whitespace-insensitive, case-insensitive as a fallback (exact
spelling wins first, so case-significant subfields such as IECEx
`60079-0v7B_DS` keep their rows), tolerates spaces around the `:`
date separator (`OIML R 117-1 : 2019`), and the hash index is per-flavor
implementation — identifiers never leak across flavors.

**URN resolution policy**: some URN schemes are edition-less — ISO's
`ISO/IEC 17025:1999`, `:2005` and `:2017` all serialize to
`urn:iso:std:iso-iec:17025`, and 40% of the iso corpus rows share their
URN with a sibling. `parse(urn)` resolves such a URN to the **latest
edition** (the greatest year among the candidates; deterministic), and
`parseUrnCandidates(urn)` exposes the full candidate set when you need
to choose differently:

```ts
const iso = corpusModeImplementation(corpus.flavors.get("iso")!.cases);
iso.parse("urn:iso:std:iso-iec:17025").toHuman(); // "ISO/IEC 17025:2017"
iso.parseUrnCandidates("urn:iso:std:iso:11681:-2").length; // 5 editions
```

**Scope caveat**: corpus mode is a conformance surface and a fixture for
the grammar waves, **not an open-universe runtime parser**. A real-world
identifier absent from the testsuite (a corpus of N cases for a body with
many times N documents) is rejected by design. Consumers whose identifier
universe exceeds the corpus — runtime resolution over live catalogues —
need the grammar waves below. `loadCorpus` (the conformance path) reads a
pubid-testsuite checkout from the filesystem and pulls `yaml` at runtime;
`loadBundledCorpus` needs neither — the prebuilt artifact ships in the
package — though it still uses Node's `fs`/`zlib` to read it, so
browser runtimes remain out of scope.

The conformance gate enforces corpus mode over the whole testsuite on
every CI run: 46/46 flavors, canonical hash, human form, URN, alias
normalization, negative rejection and deserialize idempotency.

## Grammar mode: open-universe runtime parsing

All 46 flavors are grammar-backed and ship the wave plan end to end
(core model → parser engine → builder → normalizer → renderer → urn →
per-flavor grammars). Grammar implementations parse real-world
identifiers far beyond the published corpus — novel spellings, unseen
numbers, live catalogues — and the conformance gate still enforces
parity with the corpus floor on every run, so a grammar can never
regress below what corpus mode set:

```ts
import { grammarImplementation } from "@pubid/pubid";

const oiml = grammarImplementation("oiml")!;
oiml.parse("OIML R 60-1:2021");            // any published identifier
oiml.parse(oiml.parse("OIML R 117-1").toUrn()!); // URNs ingest back
```

`grammarImplementation` is exported from the package root. URN ingestion
ships per flavor where the Ruby reference implements a URN parser
(oiml today; the remaining flavors throw a clear "not yet supported"
error naming this issue until their ports land).

## The parse surface: one call per parse concern

pubid/pubid-ts#226 exports the full parse surface from the package root
so consumers — relaton-api-js first (their #176/#182/#165) — can drop
their internal derivation entirely. Every export mirrors the Ruby
reference's semantics; the lane keys are the corpus lanes (the goldens
their key generator computes) and are parity-tested against them:

```ts
import { parse, parseOk, render, laneKeys, ParseError } from "@pubid/pubid";

const r = parse("ISO 19115-1:2014", "iso");
r.components;   // the structured components: the reference's canonical
                // toHash record, every facet typed per the corpus schema
r.canonical;    // the canonical human spelling
r.urn;          // the URN (undefined when the flavor emits none)
r.year; r.part; // the year and the structural part (base-inherited)
r.keys;         // { dated: "ISO19115-1:2014", undated: "ISO19115-1",
                //   all_parts: "ISO19115" }

render("ISO 9001", "iso");    // "ISO 9001" — the canonical render
parseOk("ISO 9001", "iso");   // true  — the verdict helper; never throws
parseOk("garbage", "iso");    // false — rejections raise ParseError
```

The lane keys: `dated` (the norm — the canonical uppercased and
de-spaced), `undated` (every colon-year not followed by a dash is gone,
base and supplement alike) and `all_parts` (the parsed part stripped —
structurally only, never by guessing). The derivation helpers
`norm` / `undatedNorm` / `allPartsNorm` compose into them and are
exported individually. The flavor must be named: grammar-ported flavors
parse open-endedly; the rest resolve over the bundled corpus. `parse`
raises `ParseError` (with `input`, `flavor` and the wrapped engine
`cause`) on every rejection.

## Worker-safe registration: the pubid-scheme URN codec

The package root (and the grammar barrel `dist/flavors/index.js` it
re-exports) statically reaches `dist/parg/runtime.js`, whose module
scope walks up to a `package.json` through `node:fs` — impossible in a
worker bundle. Identifier-type *registration* carries no such
dependency, so the worker entry composes the per-flavor registration
manifest (`src/flavors/register-types.ts`) with the codec, and one
import registers every flavor:

```ts
import { PubidUrn } from "@pubid/pubid/dist/register-types.js";

const id = PubidUrn.fromSlug("iso/is/9001/year-2015"); // resolves
```

With the manifest loaded, `PubidUrn.fromSlug` covers all 41 flavors
that resolve identifier types (nist, ieee and oiml included — the three
the barrel could not reach from a worker). `grammarImplementation`
(open-ended parse routing) deliberately stays behind the node-only
barrel: the barrel as a whole still carries the node-only parg runtime
for the ten other artifact-backed flavors. The invariants are pinned by
`test/register-types.test.ts`: the manifest registers exactly the
barrel's type set, and no node-only module is reachable from the worker
entry's import graph.

## Worker-safe parse: nist / ieee / oiml (pubid-ts#232)

The three flavors the barrel could not serve in a worker now ship
dedicated worker entries with no `node:*` module in their import graph:

- **nist / ieee** run the baked PARG artifact over parsanol's wasm
  engine. Their implementations are environment-agnostic; the node
  entries (`dist/flavors/<flavor>/index.js`) keep the lazy `node:fs`
  artifact load they always had (zero regression), while the worker
  entries build the same implementations over `parsanol/browser` and
  the artifact bundled at build time (`dist/parg/artifacts/` — the same
  checksummed payloads `vendor/parg/` ships, re-emitted by
  `npm run artifact` so the two cannot drift). The ~2.7 MB wasm loads
  lazily on the first entry call, once per isolate; the parse calls
  themselves stay synchronous.
- **oiml** never needed the artifact — its grammar is the pure-TS
  parslet port. It lacked a flavor index; it now has one
  (`dist/flavors/oiml/index.js`, the node barrel surface), and the
  worker entry routes its co-published ISO side to the parg-free iso
  implementation. No wasm at all.

## Worker-safe parse: the shared-builder family (pubid-ts#236)

Five more flavors were unreachable in a worker for a different reason:
**bsi, cen_cenelec, csa** and **gost** build on the central
`grammarImplementation` (the node barrel) for their adopted-identifier
routing, and the barrel statically imports the parg-backed flavors —
so importing the flavor reached `node:fs` even though the flavor's own
grammar is the pure-TS parslet port. **evs** composes the CEN/CENELEC
builder, so it dragged the same graph transitively.

They now take their foreign-flavor resolution as a parameter
(`src/flavors/foreign-resolver.ts`): the node barrel wires the full
central registry (node behavior unchanged), and the worker entries
wire `workerForeignResolver()` (`src/flavors/worker-registry.ts`) — a
registry over the worker-available subset (the pure-TS parslet ports
plus oiml/iso/iec). The gost-style fallback walks then run over the
worker-available flavors only, which is the honest answer in a worker:
a flavor whose worker implementation does not exist yet answers
`undefined` there, exactly like an unknown flavor does in the node
barrel. Widen the set by merging the parg worker entries in:

```ts
import { bsiWorkerGrammarImplementation } from "@pubid/pubid/dist/flavors/bsi/worker.js";
import { cenCenelecWorkerGrammarImplementation } from "@pubid/pubid/dist/flavors/cen_cenelec/worker.js";
import { csaWorkerGrammarImplementation } from "@pubid/pubid/dist/flavors/csa/worker.js";
import { gostWorkerGrammarImplementation } from "@pubid/pubid/dist/flavors/gost/worker.js";
import { evsWorkerGrammarImplementation } from "@pubid/pubid/dist/flavors/evs/worker.js";

// Sync — no wasm, no artifact: the grammars are pure TS.
const bsi = bsiWorkerGrammarImplementation();
const cen = cenCenelecWorkerGrammarImplementation();
const csa = csaWorkerGrammarImplementation();
const gost = gostWorkerGrammarImplementation();
const evs = evsWorkerGrammarImplementation();

bsi.parse("BS EN ISO 105-B06:2020"); // adopted → worker iso
cen.parse("EN ISO 11140-3:2009");
csa.parse("CSA ISO/IEC 8824-1:22");
gost.parse("GOST 31425.2-2025/ISO 9902-2:2001"); // adoption → worker iso
evs.parse("EVS-EN ISO 14001:2026"); // → worker cen → worker iso
```

Each entry accepts a resolver to widen or narrow the foreign set —
`workerForeignResolverWith({ ieee: await ieeeWorkerGrammarImplementation(wasm) })`
puts the parg-backed ieee worker entry into gost's fallback walk.

A Cloudflare Worker consumes them like this (`relaton-api-js`'s
`engine.ts`; `NO_WORKER_ENGINE = {nist, ieee, oiml}` dissolves). The
wasm argument is whatever `parsanol/browser`'s `initialize()` takes —
URL (the lazy path: a one-time R2/CDN fetch on the first parse), a
CompiledWasm module (bundled), or raw bytes:

```ts
// Lazy (the ~2.7 MB wasm fetches once, on the first nist/ieee entry call):
const WASM_URL = "https://assets.example.com/parsanol/parsanol_bg.wasm";

import { nistWorkerGrammarImplementation } from "@pubid/pubid/dist/flavors/nist/worker.js";
import { ieeeWorkerGrammarImplementation } from "@pubid/pubid/dist/flavors/ieee/worker.js";
import { oimlWorkerGrammarImplementation } from "@pubid/pubid/dist/flavors/oiml/worker.js";

const nist = await nistWorkerGrammarImplementation(WASM_URL);
const ieee = await ieeeWorkerGrammarImplementation({ wasm: WASM_URL });
const oiml = oimlWorkerGrammarImplementation(); // sync — no wasm at all

nist.parse("NIST SP 800-53r5");
ieee.parse("IEEE Std 802.3-2022");
oiml.parse("OIML R 49-1:2024"); // and "ISO 4064-1:2024|OIML R 49-1:2024"
```

Bundled instead of fetched: vendor the wasm (its `exports` map does not
expose the vendored file as a subpath, so copy
`node_modules/parsanol/vendor/parsanol-web/parsanol_bg.wasm` into your
repo) and declare wrangler's CompiledWasm rule:

```toml
# wrangler.toml — workerd compiles it at bundle load, no dynamic codegen:
rules = [{ type = "CompiledWasm", globs = ["**/parsanol_bg.wasm"], fallthrough = true }]
```

```ts
import parsanolWasm from "../vendor/parsanol_bg.wasm"; // WebAssembly.Module
const nist = await nistWorkerGrammarImplementation(parsanolWasm);
```

The ieee worker entry routes its co-published iec side
through the parg-free iec implementation; the ansi side has no worker
implementation yet and rejects with the same "ANSI implementation
unavailable" the node router produces for an unknown flavor — inject
your own via `ieeeWorkerGrammarImplementation({ coPublished })`.

The receipts are pinned in CI: `npm run test:worker` runs
`test/worker/worker-parse.test.ts` inside workerd with NO
`nodejs_compat` (vitest-pool-workers) — the nist/ieee/oiml entries and
the five shared-builder entries all parse their attested corpus
examples there — and `worker-graph.test.ts`
walks the compiled import graphs (no `node:*` module, nothing beyond
`parsanol/browser`) and bundles every entry with
`esbuild --platform=neutral` and no node externals.

## Development

```sh
npm ci
npm test            # builds + runs the corpus harness tests
npm run test:worker # the worker gate: parse inside workerd, no nodejs_compat
npm run conformance # prints the quadrant report for the pinned corpus
```
