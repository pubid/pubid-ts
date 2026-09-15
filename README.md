# pubid-ts

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

**All 41 flavors fully supported — corpus mode.** The pubid-testsuite
corpus is the published identifier universe (every canonical spelling,
canonical hash and URN, plus every attested non-normalized alias), and
pubid-ts resolves and normalizes any identifier in it:

```ts
import { loadCorpus, corpusModeImplementation } from "pubid-ts";

const corpus = loadCorpus("path/to/pubid-testsuite/tests");
const oiml = corpusModeImplementation(corpus.flavors.get("oiml")!.cases);
const id = oiml.parse("…");       // rejects unpublished spellings
id.toHuman(); id.toUrn();         // canonical forms
id.toHash();                      // canonical serialized record
id.fromHash(id.toHash());         // idempotent deserialization
```

The conformance gate enforces corpus mode over the whole testsuite on
every CI run: 41/41 flavors, canonical hash, human form, URN, alias
normalization, negative rejection and deserialize idempotency.

Grammar-backed parsing (novel identifiers beyond the published corpus)
lands wave by wave and takes over per flavor — the same gate then
enforces parity, so a wave can never regress below the floor corpus
mode set (waves: core model → parser engine → builder → normalizer →
renderer → urn → iso → iec → …).

## Development

```sh
npm ci
npm test            # builds + runs the corpus harness tests
npm run conformance # prints the quadrant report for the pinned corpus
```
