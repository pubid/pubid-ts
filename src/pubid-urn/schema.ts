/**
 * The schema definition DSL of the pubid-scheme URN — the TS mirror of
 * Pubid::PubidUrn::Atom/Facet/TypeSchema/FlavorSchema
 * (lib/pubid/pubid_urn/schema.rb).
 *
 * One prefixed atom: an optional value, found by its prefix and not by
 * its position ("part-1", "co-IEC,IEEE", "ids-(iso:is:9001)"). A facet
 * is a spelling-only value, written in the trailing "f" group.
 *
 * The URN shape of one concrete identifier type is a TypeSchema: the
 * positional core, the atoms in their canonical order, the facets. A
 * flavor's FlavorSchema declares flavor-level atoms/facets that apply
 * to every type, plus one TypeSchema per concrete type.
 */

export type AtomKind = "string" | "list" | "bool" | "bools" | "int" | "id" | "ids";
export type FacetKind = "string" | "list" | "bool" | "bools";
export type CoreKind = "string" | "int";

/** A list kind => the kind of its elements. */
const LIST_KINDS: Partial<Record<AtomKind | FacetKind, "string" | "bool">> = {
  list: "string",
  bools: "bool",
};

export class Atom {
  readonly parts: readonly string[];
  constructor(
    readonly path: string,
    readonly prefix: string,
    readonly kind: AtomKind,
  ) {
    this.parts = path.split(".");
  }

  get list(): boolean {
    return LIST_KINDS[this.kind] !== undefined;
  }

  /** The kind of one value (of one element of a list). */
  get element(): "string" | "bool" | AtomKind {
    return LIST_KINDS[this.kind] ?? this.kind;
  }
}

export class Facet {
  readonly parts: readonly string[];
  constructor(
    readonly path: string,
    readonly name: string,
    readonly kind: FacetKind,
  ) {
    this.parts = path.split(".");
  }

  get list(): boolean {
    return LIST_KINDS[this.kind] !== undefined;
  }

  get element(): "string" | "bool" | FacetKind {
    return LIST_KINDS[this.kind] ?? this.kind;
  }
}

export type CoreSpec = string | [path: string, kind: CoreKind];
export type AtomSpec = [path: string, prefix: string, kind?: AtomKind];
export type FacetSpec = [path: string, name: string, kind?: FacetKind];

/** The URN shape of one concrete identifier type. */
export class TypeSchema {
  readonly core: readonly (readonly string[])[];
  readonly coreKinds: readonly CoreKind[];
  readonly atoms: readonly Atom[];
  readonly facets: readonly Facet[];
  private readonly atomIndex: Map<string, number>;
  private readonly facetNames: Map<string, Facet>;

  constructor(
    readonly flavor: string,
    readonly type: string,
    readonly token: string,
    core: readonly CoreSpec[],
    atoms: readonly Atom[],
    facets: readonly Facet[],
  ) {
    this.core = core.map((spec) => (typeof spec === "string" ? spec : spec[0]).split("."));
    this.coreKinds = core.map((spec) => (typeof spec === "string" ? "string" : spec[1]));
    this.atoms = atoms;
    this.facets = facets;
    this.atomIndex = new Map(atoms.map((atom, i) => [atom.prefix, i] as const));
    this.facetNames = new Map(facets.map((facet) => [facet.name, facet] as const));
  }

  /** The canonical position of the atom whose prefix starts `token`,
   *  or undefined when `token` is no atom of this type. */
  atomPosition(token: string): number | undefined {
    const m = /^([a-z0-9]+)-/.exec(token);
    if (m === null) return undefined;
    return this.atomIndex.get(m[1] as string);
  }

  facet(name: string): Facet | undefined {
    return this.facetNames.get(name);
  }
}

const NAME = /^[a-z][a-z0-9]*$/;
const RESERVED_TOKENS = new Set(["f", "type"]);

export interface TypeDeclaration {
  /** The positional core paths; an entry is a path (a String value) or
   *  [path, kind], kind "string" or "int". Default ["number"]. */
  core?: CoreSpec[];
  /** Extra atoms: [path, prefix, kind?]. */
  atoms?: AtomSpec[];
  /** Extra facets: [path, name, kind?]. */
  facets?: FacetSpec[];
}

/**
 * The pubid-scheme schema of one flavor: the canonical atom order, the
 * facets, and one TypeSchema for each concrete type.
 *
 * Atoms and facets declared at flavor level apply to every type, in the
 * order of declaration; a type adds its own after them. A type token, an
 * atom prefix and a facet name are a lower-case letter followed by
 * lower-case letters and digits, so none can contain the "-" that ends a
 * prefix or the "." that qualifies a token of another flavor.
 */
export class FlavorSchema {
  readonly flavor: string;
  readonly types = new Map<string, TypeSchema>();
  private readonly tokens = new Map<string, TypeSchema>();
  private atoms: Atom[] = [];
  private facets: Facet[] = [];

  constructor(flavor: string) {
    this.flavor = flavor;
  }

  atom(path: string, prefix: string, kind?: AtomKind): void {
    this.atoms.push(buildAtom(path, prefix, kind));
  }

  facet(path: string, name: string, kind?: FacetKind): void {
    this.facets.push(buildFacet(path, name, kind));
  }

  type(type: string, token: string, declaration: TypeDeclaration = {}): void {
    checkName(token, "type token");
    if (RESERVED_TOKENS.has(token) || this.tokens.has(token)) {
      throw new Error(`type token ${JSON.stringify(token)} is reserved or taken`);
    }

    const core = (declaration.core ?? ["number"]).map(buildCore);
    const allAtoms = [...this.atoms, ...(declaration.atoms ?? []).map((spec) => buildAtom(...spec))];
    checkUnique(allAtoms.map((atom) => atom.prefix), "atom prefix", type);
    const allFacets = [
      ...this.facets,
      ...(declaration.facets ?? []).map((spec) => buildFacet(...spec)),
    ];
    checkUnique(allFacets.map((facet) => facet.name), "facet name", type);

    const schema = new TypeSchema(this.flavor, type, token, core, allAtoms, allFacets);
    this.types.set(type, schema);
    this.tokens.set(token, schema);
  }

  forToken(token: string): TypeSchema | undefined {
    return this.tokens.get(token);
  }

  forType(type: string): TypeSchema | undefined {
    return this.types.get(type);
  }
}

function buildCore(spec: CoreSpec): CoreSpec {
  const kind = typeof spec === "string" ? "string" : spec[1];
  if (kind !== "string" && kind !== "int") {
    throw new Error(`unknown core kind ${JSON.stringify(kind)}`);
  }
  return spec;
}

function buildAtom(path: string, prefix: string, kind?: AtomKind): Atom {
  checkName(prefix, "atom prefix");
  return new Atom(path, prefix, checkKind(path, kind, ATOM_KINDS, "atom") as AtomKind);
}

function buildFacet(path: string, name: string, kind?: FacetKind): Facet {
  checkName(name, "facet name");
  return new Facet(path, name, checkKind(path, kind, FACET_KINDS, "facet") as FacetKind);
}

const ATOM_KINDS: readonly string[] = ["string", "list", "bool", "bools", "int", "id", "ids"];
const FACET_KINDS: readonly string[] = ["string", "list", "bool", "bools"];

/** A path with "*" reads a list, so its kind must be a list kind. */
function checkKind(path: string, kind: string | undefined, kinds: readonly string[], what: string): string {
  const listed = path.split(".").includes("*");
  const resolved = kind ?? (listed ? "list" : "string");
  if (!kinds.includes(resolved)) {
    throw new Error(`unknown ${what} kind ${JSON.stringify(resolved)}`);
  }
  if (listed && LIST_KINDS[resolved as AtomKind] === undefined) {
    throw new Error(
      `${what} ${JSON.stringify(path)} reads a list, so its kind must be one of list, bools`,
    );
  }
  return resolved;
}

function checkName(name: string, what: string): void {
  const m = NAME.exec(name);
  if (m === null || m[0].length !== name.length) {
    throw new Error(`${what} ${JSON.stringify(name)} must match ${NAME.source}`);
  }
}

function checkUnique(names: string[], what: string, type: string): void {
  const counts = new Map<string, number>();
  for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1);
  for (const [name, count] of counts) {
    if (count > 1) {
      throw new Error(`${what} ${JSON.stringify(name)} repeats in ${type}`);
    }
  }
}
