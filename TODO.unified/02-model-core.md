# 02 — Model core: `src/model/` design

Mirror of pubid's `Pubid::Identifier` + lutaml key_value semantics, cut to
what the corpus gate exercises. NO hand-rolled serialization anywhere
outside this module — flavors declare, the core derives.

## Files

```
src/model/
  component.ts      Components: PubidDate, Publisher, Language, Edition, Code, Iteration
  attribute.ts      AttributeSpec + extendAttributes(Parent, defs)
  identifier.ts     BaseIdentifier: constructor, toHash (canonical), fromHash (dispatch)
  mapping.ts        KeyValue mapping declarations (wire names, converters, polymorphic map)
  urn-generator.ts  BaseUrnGenerator template (TODO.unified/01 §4)
  builder.ts        BaseBuilder (TODO.unified/01 §5)
  renderer.ts       RenderContext + renderComponent helper
```

## attribute.ts

```ts
export type AttributeType = "string" | "integer" | "boolean"
  | typeof PubidDate | typeof Publisher | typeof Language | typeof Edition | typeof Code;

export interface AttributeSpec {
  type: AttributeType;
  default?: unknown;              // value or () => unknown
  collection?: boolean;
  initializeEmpty?: boolean;      // materialize [] when hash omits the key
}

export type AttributeTable = Record<string, AttributeSpec>;

// Ruby snapshots the parent table at class-definition time; TS composes:
export function extendAttributes(parent: { attributes: AttributeTable }, defs: AttributeTable): AttributeTable
```

Base table (mirrors identifier.rb:503-525, minus what no ported flavor
uses yet — keep the names so later flavors match): `number`/`part`/
`subpart` (string), `date` (PubidDate), `edition` (Edition), `languages`
(Language, collection), `publisher` (Publisher), `copublishers`
(Publisher, collection), `allParts` (boolean, default false). `_type` is
NOT a table entry — it is always emitted first, from the class's
`polymorphicName`.

## component.ts

Each component: plain fields, `render(context)`, `toWire()` (its hash
form), `isDegenerate(field)` (only `field` set, non-default, scalar).
`PubidDate.render("urn")` = year; `.render("human")` = "YYYY[-MM[-DD]]"
pad2; "--" undated; `present?`. Publisher/Language downcase under urn.
Language CHAR_MAP R/F/E/A/S/D ↔ ru/fr/en/ar/es/de with `originalCode`.

## mapping.ts

```ts
export interface FieldMapping {
  wire: string;                    // wire key
  to: string;                      // attribute name
  toWire?: (model) => unknown;     // custom converter (calconnect year/month/day)
  fromWire?: (hash) => unknown;
}
export function keyValue(...fields): FieldMapping[]
```

Default mapping when a flavor declares none: every attribute under its
own name. `_type` handled by the core. Custom `toWire/fromWire` pairs
correspond to Ruby's `map "year", with: {to:, from:}` (calconnect's flat
date) — the only sanctioned place a wire shape is imperative.

## identifier.ts — BaseIdentifier

```ts
export interface IdentifierClass extends-newable {
  polymorphicName: string;                 // "pubid:flavor:type-kebab"
  attributes: AttributeTable;              // composed via extendAttributes
  mappings?: FieldMapping[];               // optional overrides
  typeMap?: Record<string, IdentifierClass>; // _type -> class (from_hash dispatch)
}

export abstract class BaseIdentifier {
  constructor(attrs: Record<string, unknown>)   // assigns declared attrs only, coerces types
  toHash(): Record<string, unknown>
  static fromHash(hash): BaseIdentifier
}
```

`toHash()` pipeline (exactly TODO.unified/01 §2):

1. Emit `_type: polymorphicName` first.
2. For each mapped attribute: serialize (component → `toWire()`; scalar →
   as-is; integer → number).
3. **canonicalize**: drop empty values and values equal to the attribute
   default; recurse into components and collections.
4. **flatten degenerate components** with the shared table
   (`edition`→`edition`, `date`→`year`, `stageIteration`→itself;
   collections of degenerates → scalar lists), honoring the guards
   (never overwrite an emitted wire key; never rename onto a declared
   attribute name).
5. `compactHash(model, hash)` class hook (default no-op).

`fromHash(hash)`:

1. Dispatch on `_type` through `typeMap` (registered flavors) — cross-
   flavor nesting delegates to the owning flavor's class.
2. Inflate flat scalars back to component hashes, skipping converter
   keys and declared-attribute collisions.
3. Construct with type coercion (hash → component class, string passthrough).

Type coercion rules: `"string"` → String(v); `"integer"` → Number(v);
component type → v instanceof ? v : new Type(v as hash); collection →
array of coerced elements; `initializeEmpty` → `[]`.

## Verification for the core

A new `test/model.test.ts` pins the core against Ruby probes run in the
same cycle (each probe pasted in the test):
- canonicalize drops defaults/empties (all_parts=false, defaulted strings)
- degenerate edition/date flattening incl. the `date`→`year` rename and
  the copublishers scalar list
- polymorphic dispatch round-trip `fromHash(toHash()) == toHash()`
- BaseUrnGenerator reproduces `urn:doi`, `urn:isbn`, `urn:omg`,
  `urn:omg:-PDF` from the doi/isbn/omg attribute tables (no per-flavor URN code).
