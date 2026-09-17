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
6. `parse` must consume the whole input, else ParseFailed.

Check the alternation ORDER — PEG tries in order and a successful
branch is never re-entered (Ruby comments mark load-bearing orderings;
copy them into the TS rule comments).

## Checklist per flavor

1. **Read the whole Ruby flavor first**: parser.rb, builder.rb,
   identifier.rb (+ single/supplement bases), identifiers/*.rb,
   renderer.rb, urn_generator.rb, components/. The Ruby builders read
   parse TREES — your builder must read the same tree shape.
2. **grammar.ts**: translate every `rule(:name)` 1:1, same names. Keep
   the Ruby comments about ordering/guards. Reference rules with
   `ref(rules, "name")` (lazy — grammars recurse).
3. **model.ts**:
   - Model the identifier as a discriminated union on `kind` (the
     `_type` tail) rather than a class hierarchy.
   - `build*(tree)`: port builder.rb branch by branch. Watch the Ruby
     idioms: `parsed_hash[:x].to_s if parsed_hash[:x]` (drop when
     absent), `edition_format.is_a?(Hash) ? ... : ...`, recursion into
     `:base`.
   - `toHash`: the key_value maps **under pubid's canonical
     no-defaults rule** — drop nil/empty, drop booleans whose default
     is false, drop attrs equal to their declared default (e.g.
     `parsed_format` default "short" is dropped when "short"). The
     corpus `identifier` payload IS this hash; the gate compares it.
   - `toHuman`: port renderer.rb; respect `requested_format`/
     `parsed_format` precedence exactly.
   - `toUrn`: port urn_generator.rb; note the base-class fallbacks
     (`urn_type` returns "r" when the identifier has no type letter —
     supplements lean on this; `urn_year` falls back to the `year`
     attribute).
4. **implementation.ts**: `parse(input)` = `build(parseGrammar(oimlGrammar, input))`
   wrapped in the FlavorImplementation interface.
5. **Register** the flavor in `src/flavors/index.ts`.
6. **Test** (`test/grammar-<flavor>.test.ts`):
   - registry entry present; unrelated flavors still undefined;
   - the headline OPEN-ENDED parse (a real-world identifier absent
     from the corpus — the whole point of the wave);
   - run the FULL flavor corpus slice through `runFlavor` with the
     grammar implementation: zero failures;
   - non-identifiers raise (parse, never nil).

## Verification

`npm run conformance` — the ported flavor must stay `pass` with
`fail=0` (the gate now exercises the grammar, not corpus mode), and
`npm test` keeps 18+ tests green. A wave may never regress below the
corpus floor.
