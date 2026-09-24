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

**All 42 flavors supported in corpus mode.** The pubid-testsuite corpus is
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
every CI run: 42/42 flavors, canonical hash, human form, URN, alias
normalization, negative rejection and deserialize idempotency.

## Grammar mode: open-universe runtime parsing

All 42 flavors are grammar-backed and ship the wave plan end to end
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

## Development

```sh
npm ci
npm test            # builds + runs the corpus harness tests
npm run conformance # prints the quadrant report for the pinned corpus
```
