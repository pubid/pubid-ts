/**
 * Reads the body of a pubid-scheme URN back into an identifier hash —
 * the TS mirror of Pubid::PubidUrn::Decoder (lib/pubid/pubid_urn/decoder.rb).
 * The inverse of Encoder; strict about structure. Canonical form (atom
 * order, escapes, trailing "~") is checked by PubidUrn.parse, which
 * re-encodes the result and compares.
 */

import { decode as escape, exactMatch } from "./escape.js";
import { UrnParseError } from "./errors.js";
import { put, isNil } from "./paths.js";
import { Decoder as _Decoder } from "./decoder.js";
import type { Atom, Facet } from "./schema.js";
import { flavorSchema, splitToken, splitTop, structural } from "./index.js";
import type { TypeSchema } from "./schema.js";

const FACET = /^(\d+)\.([a-z0-9]+)-(.*)/;
const INTEGER = /^-?[0-9]+$/;
const NULL = "~";

export class Decoder {
  constructor(private readonly body: string) {}

  /** The identifier hash (`_type` and `base` included). */
  toIdentifierHash(): Record<string, unknown> {
    const sep = this.body.indexOf(":");
    const flavor = sep === -1 ? undefined : this.body.slice(0, sep);
    const rest = sep === -1 ? undefined : this.body.slice(sep + 1);
    if (rest === undefined || rest === "") this.fail("no type segment");
    return this.decodeIdentifier(rest as string, flavor as string);
  }

  private decodeIdentifier(body: string, flavor: string): Record<string, unknown> {
    const tokens = splitTop(body, ":");
    const nodes: Record<string, unknown>[] = [];
    const schemas: TypeSchema[] = [];
    let i = 0;
    while (i < tokens.length) {
      const token = tokens[i] as string;
      if (token === "f") {
        this.decodeFacets(tokens.slice(i + 1), nodes, schemas);
        break;
      }

      const schema = this.nodeSchema(token, flavor);
      const node: Record<string, unknown> = { _type: schema.type };
      i = this.decodeCore(tokens, i + 1, node, schema);
      i = this.decodeAtoms(tokens, i, node, schema);
      nodes.push(node);
      schemas.push(schema);
    }
    if (nodes.length === 0) this.fail("no identifier");

    for (let k = 1; k < nodes.length; k++) {
      nodes[k]!["base"] = nodes[k - 1];
    }
    return nodes[nodes.length - 1] as Record<string, unknown>;
  }

  private nodeSchema(token: string, flavor: string): TypeSchema {
    if (token === "type") {
      this.fail("type-metadata URN names a type, not a document");
    }

    let schema: TypeSchema | undefined;
    if (structural(token)) {
      const [owner, name] = splitToken(token, flavor);
      schema = flavorSchema(owner)?.forToken(name);
    }
    if (schema === undefined) {
      this.fail(`unknown type or segment ${JSON.stringify(token)}`);
    }
    return schema as TypeSchema;
  }

  private decodeCore(tokens: string[], index: number, node: Record<string, unknown>, schema: TypeSchema): number {
    let i = index;
    for (let ci = 0; ci < schema.core.length; ci++) {
      if (i >= tokens.length) break;

      const token = tokens[i] as string;
      if (structural(token)) break;

      if (token !== NULL) {
        put(node, schema.core[ci] as string[], this.coreValue(token, schema.coreKinds[ci] as string));
      }
      i += 1;
    }
    return i;
  }

  private coreValue(token: string, kind: string): unknown {
    return kind === "int" ? this.integer(token) : escape(token);
  }

  private decodeAtoms(tokens: string[], index: number, node: Record<string, unknown>, schema: TypeSchema): number {
    let last = -1;
    let i = index;
    while (i < tokens.length) {
      const token = tokens[i] as string;
      const position = schema.atomPosition(token);
      if (position === undefined) break;
      if (position <= last) {
        this.fail(`atom ${JSON.stringify(token)} is out of order or repeated`);
      }

      last = position;
      const atom = schema.atoms[position] as Atom;
      const dash = token.indexOf("-");
      const raw = dash === -1 ? "" : token.slice(dash + 1);
      put(node, atom.parts as string[], this.atomValue(raw, atom));
      i += 1;
    }
    return i;
  }

  private atomValue(raw: string, atom: Atom): unknown {
    if (atom.kind === "int") return this.integer(raw);
    if (atom.kind === "id") return this.nested(raw);
    if (atom.kind === "ids") return splitTop(raw, ",").map((item) => this.nested(item));
    return this.slotValue(raw, atom);
  }

  /** The value of a :string, :bool or list atom, or of a facet. */
  private slotValue(raw: string, slot: Atom | Facet): unknown {
    if (!slot.list) return this.scalar(raw, slot);

    return splitTop(raw, ",", true).map((item) =>
      item === NULL ? null : this.scalar(item, slot),
    );
  }

  private scalar(raw: string, slot: Atom | Facet): unknown {
    return slot.element === "bool" ? this.boolean(raw) : escape(raw);
  }

  private boolean(raw: string): boolean {
    if (raw === "true") return true;
    if (raw === "false") return false;
    this.fail(`${JSON.stringify(raw)} is not a boolean`);
  }

  private integer(raw: string): number {
    const m = INTEGER.exec(raw);
    if (m === null || m[0].length !== raw.length) {
      this.fail(`${JSON.stringify(raw)} is not an integer`);
    }
    return Number(raw);
  }

  private nested(raw: string): Record<string, unknown> {
    if (!raw.startsWith("(") || !raw.endsWith(")")) {
      this.fail(`nested identifier ${JSON.stringify(raw)} needs brackets`);
    }
    return new _Decoder(raw.slice(1, -1)).toIdentifierHash();
  }

  private decodeFacets(tokens: string[], nodes: Record<string, unknown>[], schemas: TypeSchema[]): void {
    if (tokens.length === 0) this.fail("empty facet group");

    for (const token of tokens) {
      const match = exactMatch(FACET, token);
      if (match === null) this.fail(`bad facet ${JSON.stringify(token)}`);
      const index = Number(match[1]);
      const schema = schemas[index];
      if (schema === undefined) this.fail(`facet ${JSON.stringify(token)} has no node`);
      const facet = schema.facet(match[2] as string);
      if (facet === undefined) this.fail(`bad facet ${JSON.stringify(token)}`);
      put(nodes[index] as Record<string, unknown>, facet.parts as string[], this.slotValue(match[3] as string, facet));
    }
  }

  private fail(message: string): never {
    throw new UrnParseError(`pubid URN ${JSON.stringify(this.body)}: ${message}`);
  }
}
