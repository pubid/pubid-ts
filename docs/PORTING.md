# Porting a pubid flavor from Ruby to TypeScript (grammar waves)

This guide distills the OIML port (wave 1, PR "Grammar wave 1") into a
repeatable checklist. The pipeline mirrors the Ruby reference
flavor-for-flavor, so each port is mostly mechanical once the engine
semantics are respected.

## The mapping

| Ruby (lib/pubid/<flavor>/)              | TypeScript (src/flavors/<flavor>/)        |
|-----------------------------------------|-------------------------------------------|
| parser.rb (parslet rules)               | grammar.ts (rule tree over the engine)    |
| builder.rb (tree -> identifier)         | model.ts, `build*` functions              |
| renderer.rb (+ render_base overrides)   | model.ts, `toHuman`                       |
| urn_generator.rb                        | model.ts, `toUrn`                         |
| identifier.rb key_value maps            | model.ts, `toHash` / `fromHash`           |

## Engine semantics you must not violate

The engine (`src/grammar/engine.ts`) reproduces parslet 2.0 exactly.
The semantics below were pinned by RUNNING Ruby parslet snippets — do
not reason from memory, re-run them if in doubt:

1. **Sequence merging**: `a >> b` folds results with `combine`.
   string+string concat; **a plain string is DISCARDED** when the other
   side is a capture; hash+hash merges (duplicate key raises — Ruby's
   "Duplicate subtrees"); nil is transparent.
2. **`.as(key)`** wraps anything: `{key: result}` — even a failed
   `.maybe` becomes `{key: null}` (the key is PRESENT with nil).
3. **`.maybe`** is one attempt -> the value or **nil** (never an empty
   array). Ruby builders branch on `is_a?(Hash)` because of this.
4. **`.repeat`** is greedy and does NOT backtrack a successful
   iteration (parslet: "Expected at least N of ..."). Results are an
   array iff any iteration captured, else a concatenated string.
5. **`match` has TWO Ruby forms** (pinned empirically): `match("[a-z]")`
   / `match("\d")` (paren) takes a FULL regex anchored at the position;
   `match["0-9"]` (bracket indexing) takes a character-class BODY and
   wraps it in `[...]`. The TS engine implements the paren form — when
   the Ruby source uses the bracket form, wrap the body yourself:
   `match["0-9"]` -> `match("[0-9]")`. Both match exactly ONE character.
6. `parse` must consume the whole input, else ParseFailed — enforced
   the way parslet 2.0 does it: a `consumeAll` flag runs down the parse
   spine (Sequence hands it ONLY to its last child; Alternatives pass it
   to every branch; Repetition iterations never get it), and an atom
   that succeeds with input left over FAILS as an ordinary match failure.
   Consequence (pinned against parslet 2.0): an Alternative DOES re-try
   its next branch when an earlier branch matched but left trailing
   input — e.g. ISBN's bare "080442957X" only parses via the second body
   alternative. Repetitions stay possessive: they never give back a
   completed iteration (see 4).

Alternation ORDER still matters: alternatives are tried in order, and a
branch that consumes the whole input wins outright (Ruby comments mark
load-bearing orderings; copy them into the TS rule comments).

## The unified model (src/model/) — port this FIRST

pubid flavors are thin over a shared model (Pubid::Identifier +
Components + Renderers/UrnGenerator/Builder bases). The TS mirror lives
in src/model/ with the semantics pinned in TODO.unified/01-study-pubid-core.md.
NEVER hand-roll toHash/fromHash in a flavor — declare and derive:

```ts
export class CalconnectIdentifier extends BaseIdentifier {
  static polymorphicName = "pubid:calconnect:standard";
  static attributes = extendAttributes(BaseIdentifier, {
    series: { type: "string" },
    number: { type: "string" },
  });
  static mappings = keyValue(...);          // whitelist; converters only where Ruby uses `with:`
  static urnGenerator = CalconnectUrnGenerator; // subclass of BaseUrnGenerator; omit when Ruby has no urn_generator
  render(): string { ... }                  // the human renderer (the one required method)
}
registerType(CalconnectIdentifier);
```

Model invariants (all pinned against Ruby; see TODO.unified/01):
1. `toHash` emits `_type` (polymorphicName), then mapped attributes — an
   explicit mapping list is a WHITELIST (un's runtime `date` never
   serializes); nil/empty/default-valued attributes drop.
2. Degenerate single-field components flatten (`edition` → its number;
   `date` → RENAMED `year`), collections of degenerates → scalar lists;
   guarded against emitted keys and declared-attribute collisions.
3. `fromHash` dispatches on `_type` through registerType, re-inflates
   flat scalars (except converter keys / declared-name collisions).
4. `toUrn` resolves the class's urnGenerator, else BaseUrnGenerator —
   the template reads DECLARED attributes only (maybe()), so doi →
   "urn:doi" and omg → "urn:omg:-PDF" derive with zero per-flavor URN code.
5. Builders subclass BaseBuilder: selectClass / cast / handleKey
   overrides; unknown tree keys never reach the model; shared helpers
   parseDate / parseLanguages / parseNumberWithPart / roman conversion.
6. Components (PubidDate, Publisher, Language, Edition, Iteration)
   carry the human/urn render seam (urn lowercases; date renders
   year-only under urn, "YYYY-MM-DD" human, "--" undated).

## Checklist per flavor

1. Read the whole Ruby flavor first: parser.rb, builder.rb,
   identifier.rb (+ bases), identifiers/*.rb, renderer.rb,
   urn_generator.rb (+ key_value maps!). Get ground truth by RUNNING
   the gem (to_hash / to_urn on representative inputs, plus the corpus
   yaml slices) — never from memory.
2. Declare the model (attributes + mappings + polymorphicName), port
   the grammar 1:1 (engine invariants above still apply), subclass
   BaseBuilder for the builder, write render() and (when Ruby has one)
   a BaseUrnGenerator subclass.
3. Register in src/flavors/index.ts; wave test = corpus loop +
   open-ended parsing + rejections (check the flavor's _negative.yaml).
4. npm test + npm run conformance; branch grammar/waveN-<flavors> off
   origin/main, stage explicit paths, PR with --body-file, rebase-merge
   after green CI.
