/**
 * A parslet-compatible parser-combinator engine.
 *
 * The Ruby pubid grammars are declarative parslet rule trees; porting a
 * flavor 1:1 requires the TypeScript engine to reproduce parslet's tree
 * semantics exactly, because the Ruby builders read those trees. The
 * semantics below were pinned empirically against parslet 2.0 (see the
 * porting guide in docs/PORTING.md):
 *
 * - atoms produce a string, a capture hash, an array, or nil
 * - sequences fold with `combine`: string+string concat; a plain string
 *   is DISCARDED when combined with a capture; hash+hash merges and a
 *   duplicate key raises; nil is transparent
 * - `.as(key)` wraps the result: {key: result}
 * - `.repeat` is greedy and does NOT backtrack a successful iteration to
 *   satisfy an outer minimum (parslet: "Expected at least N of ...");
 *   results are an array when any iteration captured, else a concat string
 * - `.maybe` is special-cased like parslet's Maybe: one attempt, nil on
 *   failure (not an empty array)
 * - `absent?`/`present?` are zero-width lookaheads
 * - full input consumption is enforced the way parslet 2.0 does it: a
 *   `consumeAll` flag is threaded down the parse spine — the root starts
 *   with it, a Sequence hands it ONLY to its last child, Alternatives
 *   pass it to every branch, and Repetition iterations never get it. An
 *   atom that succeeds while unconsumed input remains FAILS (parslet
 *   Base#apply's "Don't know what to do with ..." check). Because that
 *   failure is an ordinary match failure, an enclosing Alternative
 *   retries its next branch — so `a | b` DOES re-try `b` when `a`
 *   matched but left trailing input (pinned against parslet: bare
 *   "080442957X" reaches ISBN's second body alternative this way).
 */

export class ParseFailed extends Error {
  readonly pos: number;
  constructor(message: string, pos: number) {
    super(`${message} at line 1 char ${pos + 1}`);
    this.name = "ParseFailed";
    this.pos = pos;
  }
}

export type Tree = string | number | TreeObject | Tree[] | null | undefined;
export interface TreeObject {
  [key: string]: Tree;
}

/** Context threaded through every match attempt. */
class Ctx {
  input: string;
  pos = 0;
  constructor(input: string) {
    this.input = input;
  }
}

export interface Atom {
  /** Attempt a match at ctx.pos; failure throws Fail. */
  _match(ctx: Ctx, consumeAll: boolean): Tree | undefined;
}

class Fail extends Error {}

function attempt<T>(ctx: Ctx, fn: () => T): T | undefined {
  const saved = ctx.pos;
  try {
    return fn();
  } catch (e) {
    if (e instanceof Fail) {
      ctx.pos = saved;
      return undefined;
    }
    throw e;
  }
}

/**
 * parslet's Base#apply: run the atom's try, then — when the caller
 * demanded full consumption and input is left over — rewind and fail.
 * This is what lets an enclosing Alternative retry after a branch that
 * matched but did not consume everything.
 */
function applyAtom(atom: Atom, ctx: Ctx, consumeAll: boolean): Tree | undefined {
  const saved = ctx.pos;
  const result = atom._match(ctx, consumeAll);
  if (consumeAll && ctx.pos < ctx.input.length) {
    ctx.pos = saved;
    throw new Fail(
      `Don't know what to do with ${JSON.stringify(ctx.input.slice(ctx.pos, ctx.pos + 10))}`,
    );
  }
  return result;
}

/** Combine two sequence results the way parslet's Sequence does. */
function combine(a: Tree, b: Tree): Tree {
  if (a === undefined || a === null) return b;
  if (b === undefined || b === null) return a;
  if (typeof a === "string" && typeof b === "string") return a + b;
  // A plain string is discarded when the other side carries structure.
  if (typeof a === "string" && typeof b === "object") return b;
  if (typeof b === "string" && typeof a === "object") return a;
  if (typeof a === "object" && typeof b === "object") {
    if (!Array.isArray(a) && !Array.isArray(b)) {
      // parslet merge on duplicate keys: warn and keep the LATTER value
      // (astm's dual unit relies on this — the second :letter wins).
      const out: TreeObject = { ...a };
      for (const [k, v] of Object.entries(b)) {
        if (k in out) {
          console.warn(
            `Duplicate subtrees while merging result of sequence (keys: :${k}); only the values of the latter will be kept.`,
          );
        }
        out[k] = v;
      }
      return out;
    }
    return [...flatten(a), ...flatten(b)];
  }
  // number + anything: stringify
  return typeof b === "object" ? b : `${a}${b}`;
}

function flatten(t: Tree): Tree[] {
  return Array.isArray(t) ? t : [t];
}

class Str implements Atom {
  constructor(private readonly s: string) {}
  _match(ctx: Ctx, _consumeAll: boolean): Tree | undefined {
    if (ctx.input.startsWith(this.s, ctx.pos)) {
      ctx.pos += this.s.length;
      return this.s;
    }
    throw new Fail(`Expected ${JSON.stringify(this.s)}`);
  }
}

class Regex implements Atom {
  private readonly re: RegExp;
  constructor(pattern: string) {
    // parslet anchors the pattern and consumes exactly ONE match
    this.re = new RegExp(`^(?:${pattern})`);
  }
  _match(ctx: Ctx, _consumeAll: boolean): Tree | undefined {
    const m = this.re.exec(ctx.input.slice(ctx.pos));
    if (!m) throw new Fail(`Expected match on ${this.re.source}`);
    const matched = m[0];
    ctx.pos += matched.length;
    return matched;
  }
}

class Seq implements Atom {
  constructor(private readonly parts: Atom[]) {}
  _match(ctx: Ctx, consumeAll: boolean): Tree | undefined {
    let acc: Tree = undefined;
    for (let i = 0; i < this.parts.length; i++) {
      // parslet Sequence: only the LAST child inherits the must-consume
      // obligation.
      const r = applyAtom(this.parts[i]!, ctx, consumeAll && i === this.parts.length - 1);
      acc = acc === undefined && r === undefined ? undefined : combine(acc, r);
    }
    return acc;
  }
}

class Alt implements Atom {
  constructor(private readonly options: Atom[]) {}
  _match(ctx: Ctx, consumeAll: boolean): Tree | undefined {
    let lastFail = "no alternative matched";
    for (const option of this.options) {
      const r = attempt(ctx, () => applyAtom(option, ctx, consumeAll));
      if (r !== undefined) return r;
      lastFail = "alternative failed";
    }
    throw new Fail(lastFail);
  }
}

class Repeat implements Atom {
  constructor(
    private readonly atom: P | Atom,
    private readonly min: number,
    private readonly max: number,
  ) {}
  private get inner(): Atom {
    return this.atom instanceof P ? this.atom.atom : this.atom;
  }
  _match(ctx: Ctx, consumeAll: boolean): Tree | undefined {
    const results: Tree[] = [];
    let count = 0;
    while (count < this.max) {
      // parslet Repetition: iterations never carry the consume-all flag.
      const r = attempt(ctx, () => applyAtom(this.inner, ctx, false));
      if (r === undefined) break;
      results.push(r);
      count++;
      if (ctx.pos >= ctx.input.length && count < this.min) break;
    }
    if (count < this.min) {
      throw new Fail(`Expected at least ${this.min} of repetition`);
    }
    // A repetition that stopped on its own inner failure while input
    // remains and full consumption was demanded fails here (parslet's
    // post-loop unconsumed check); a repetition that hit its max leaves
    // that to applyAtom.
    if (consumeAll && count < this.max && ctx.pos < ctx.input.length) {
      throw new Fail("Don't know what to do with trailing input after repetition");
    }
    if (results.some((r) => typeof r === "object")) return results;
    return results.join("");
  }
}

class Maybe implements Atom {
  constructor(private readonly atom: P | Atom) {}
  _match(ctx: Ctx, consumeAll: boolean): Tree | undefined {
    const inner = this.atom instanceof P ? this.atom.atom : this.atom;
    const r = attempt(ctx, () => applyAtom(inner, ctx, consumeAll));
    if (r === undefined || r === "") return undefined;
    return r;
  }
}

class As implements Atom {
  constructor(
    private readonly atom: P | Atom,
    private readonly key: string,
  ) {}
  private get inner(): Atom {
    return this.atom instanceof P ? this.atom.atom : this.atom;
  }
  _match(ctx: Ctx, consumeAll: boolean): TreeObject | undefined {
    const r = this.inner._match(ctx, consumeAll);
    return { [this.key]: r === undefined ? null : r };
  }
}

class Absent implements Atom {
  constructor(private readonly atom: P | Atom) {}
  _match(ctx: Ctx, _consumeAll: boolean): Tree | undefined {
    const inner = this.atom instanceof P ? this.atom.atom : this.atom;
    const r = attempt(ctx, () => inner._match(ctx, false));
    if (r !== undefined) throw new Fail("unexpectedly matched");
    return "";
  }
}

class Present implements Atom {
  constructor(private readonly atom: P | Atom) {}
  _match(ctx: Ctx, _consumeAll: boolean): Tree | undefined {
    const inner = this.atom instanceof P ? this.atom.atom : this.atom;
    // A true lookahead that NEVER consumes input, and fails exactly when
    // the probe fails (parslet's present?): the position is restored in
    // both cases, but a non-match re-raises the ordinary failure so an
    // enclosing Alternative retries its next branch.
    const saved = ctx.pos;
    try {
      inner._match(ctx, false);
    } catch (e) {
      if (!(e instanceof Fail)) throw e;
      ctx.pos = saved;
      throw new Fail("present? probe did not match");
    }
    ctx.pos = saved;
    return "";
  }
}

class Ref implements Atom {
  private resolved?: Atom;
  constructor(
    private readonly rules: Record<string, P | Atom>,
    private readonly name: string,
  ) {}
  _match(ctx: Ctx, consumeAll: boolean): Tree | undefined {
    if (!this.resolved) {
      const rule = this.rules[this.name];
      if (!rule) throw new Error(`unknown rule :${this.name}`);
      this.resolved = rule instanceof P ? rule.atom : rule;
    }
    return this.resolved._match(ctx, consumeAll);
  }
}

/** Builder-side sugar: chainable wrapper. */
export class P {
  constructor(public readonly atom: Atom) {}
  then(...next: (P | Atom)[]): P {
    return new P(new Seq([this.atom, ...next.map(unwrap)]));
  }
  or(...others: (P | Atom)[]): P {
    return new P(new Alt([this.atom, ...others.map(unwrap)]));
  }
  repeat(min = 0, max = Infinity): P {
    return new P(new Repeat(this.atom, min, max));
  }
  maybe(): P {
    return new P(new Maybe(this.atom));
  }
  as(key: string): P {
    return new P(new As(this.atom, key));
  }
  absent(): P {
    return new P(new Absent(this.atom));
  }
  present(): P {
    return new P(new Present(this.atom));
  }
}

export function unwrap(p: P | Atom): Atom {
  return p instanceof P ? p.atom : p;
}

export function str(s: string): P {
  return new P(new Str(s));
}

/** parslet's match: a single-character regex match, e.g. match("[a-z]"). */
export function match(pattern: string): P {
  return new P(new Regex(pattern));
}

/** A named rule reference (lazily resolved — grammars are recursive). */
export function ref(rules: Record<string, P | Atom>, name: string): P {
  return new P(new Ref(rules, name));
}

export interface Grammar {
  rules: Record<string, P | Atom>;
  root: string;
}

/**
 * Parse the whole input with the grammar's root rule, parslet-style:
 * full consumption is enforced by the root's consumeAll flag, so an
 * Alternative at the spine retries a branch that left trailing input.
 */
export function parseGrammar(grammar: Grammar, input: string): Tree {
  const ctx = new Ctx(input);
  const root = new Ref(grammar.rules, grammar.root);
  const result = attempt(ctx, () => applyAtom(root, ctx, true));
  if (result === undefined) {
    throw new ParseFailed(
      `Expected one of [${grammar.root.toUpperCase()}]`,
      ctx.pos,
    );
  }
  return result;
}
