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
the barrel could not reach from a worker). The invariants are pinned by
`test/register-types.test.ts`: the manifest registers exactly the
barrel's type set, and no node-only module is reachable from the worker
entry's import graph.

## Worker-safe parsing: the artifact-backed flavors

Twelve grammars parse through a baked PARG artifact on the parsanol
wasm engine: ansi, arxiv, bsi_pfs, calconnect_pfs, ccsds, cen_pfs,
doi_pfs, etsi_pfs, eu, ieee, nist and wmo (`PARG_GRAMMARS`). In node the
engine loads its wasm and the artifacts (`vendor/parg`) from disk. The
runtime (`dist/parg/runtime.js`) has no static `node:*` import, so the
grammar barrel also loads in a worker. In a worker the consumer supplies
the wasm and the artifacts:

```ts
import wasm from "@pubid/pubid/dist/parg/parsanol_bg.wasm";
import { nistWorkerImplementation } from "@pubid/pubid/dist/flavors/nist/worker.js";
import { ieeeWorkerImplementation } from "@pubid/pubid/dist/flavors/ieee/worker.js";
import { oimlGrammarImplementation } from "@pubid/pubid/dist/flavors/oiml/index.js";

const nist = await nistWorkerImplementation(wasm); // inits the engine once
nist.parse("NIST SP 800-53r5");
(await ieeeWorkerImplementation(wasm)).parse("IEEE Std 802.3-2018"); // + the ansi artifact
oimlGrammarImplementation().parse("OIML R 60-1:2021"); // a TS grammar: no wasm
```

For any other artifact flavor, use the general entry:

```ts
import { initPargEngine, registerArtifact, grammarImplementation } from "@pubid/pubid/dist/worker.js";
import ccsds from "@pubid/pubid/dist/parg/artifacts/ccsds.js";

await initPargEngine(wasm);
registerArtifact("ccsds", ccsds);
grammarImplementation("ccsds")!.parse("CCSDS 133.0-B-2");
```

- **Size.** `parsanol_bg.wasm` is 2.6 MB: parsanol's web build, copied
  from the pinned parsanol at build time (parsanol's `exports` map does
  not expose it). The artifact modules (`dist/parg/artifacts/*.js`) total
  about 0.7 MB; nist is 188 KB and ieee is 348 KB.
- **Lazy load.** Nothing compiles the wasm until `initPargEngine` (or a
  per-flavor entry) is awaited. Call it on the first parse of an artifact
  flavor. Later calls return the same promise.
- **Errors.** A load of a grammar that is not registered (and has no
  file to read) throws `PargArtifactUnavailable` with `grammar`.
- **Bundle size.** The ieee entry, and the bsi, gost, csa and
  cen_cenelec flavors, import the grammar barrel for co-publisher
  routing, so their bundles carry every flavor's TS grammar.
- The artifact modules are generated from `vendor/parg` by
  `npm run artifact:modules` (part of `npm run artifact`);
  `test/worker-entry.test.ts` fails while one is stale. The bundle check
  (`test/worker-bundle.test.ts`) bundles each entry with the
  workerd/worker/browser conditions and fails on any `node:*` import.

## Development

```sh
npm ci
npm test            # builds + runs the corpus harness tests
npm run conformance # prints the quadrant report for the pinned corpus
```
