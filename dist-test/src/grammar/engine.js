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
 * - `parse` must consume the whole input
 */
export class ParseFailed extends Error {
    pos;
    constructor(message, pos) {
        super(`${message} at line 1 char ${pos + 1}`);
        this.name = "ParseFailed";
        this.pos = pos;
    }
}
/** Context threaded through every match attempt. */
class Ctx {
    input;
    pos = 0;
    constructor(input) {
        this.input = input;
    }
}
class Fail extends Error {
}
function attempt(ctx, fn) {
    const saved = ctx.pos;
    try {
        return fn();
    }
    catch (e) {
        if (e instanceof Fail) {
            ctx.pos = saved;
            return undefined;
        }
        throw e;
    }
}
/** Combine two sequence results the way parslet's Sequence does. */
function combine(a, b) {
    if (a === undefined || a === null)
        return b;
    if (b === undefined || b === null)
        return a;
    if (typeof a === "string" && typeof b === "string")
        return a + b;
    // A plain string is discarded when the other side carries structure.
    if (typeof a === "string" && typeof b === "object")
        return b;
    if (typeof b === "string" && typeof a === "object")
        return a;
    if (typeof a === "object" && typeof b === "object") {
        if (!Array.isArray(a) && !Array.isArray(b)) {
            const out = { ...a };
            for (const [k, v] of Object.entries(b)) {
                if (k in out) {
                    throw new Error(`Duplicate subtrees while merging result of sequence (keys: :${k})`);
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
function flatten(t) {
    return Array.isArray(t) ? t : [t];
}
class Str {
    s;
    constructor(s) {
        this.s = s;
    }
    _match(ctx) {
        if (ctx.input.startsWith(this.s, ctx.pos)) {
            ctx.pos += this.s.length;
            return this.s;
        }
        throw new Fail(`Expected ${JSON.stringify(this.s)}`);
    }
}
class Regex {
    re;
    constructor(pattern) {
        // parslet anchors the pattern and consumes exactly ONE match
        this.re = new RegExp(`^(?:${pattern})`);
    }
    _match(ctx) {
        const m = this.re.exec(ctx.input.slice(ctx.pos));
        if (!m)
            throw new Fail(`Expected match on ${this.re.source}`);
        const matched = m[0];
        ctx.pos += matched.length;
        return matched;
    }
}
class Seq {
    parts;
    constructor(parts) {
        this.parts = parts;
    }
    _match(ctx) {
        let acc = undefined;
        for (const part of this.parts) {
            const r = part._match(ctx);
            acc = acc === undefined && r === undefined ? undefined : combine(acc, r);
        }
        return acc;
    }
}
class Alt {
    options;
    constructor(options) {
        this.options = options;
    }
    _match(ctx) {
        let lastFail = "no alternative matched";
        for (const option of this.options) {
            const r = attempt(ctx, () => option._match(ctx));
            if (r !== undefined)
                return r;
            lastFail = "alternative failed";
        }
        throw new Fail(lastFail);
    }
}
class Repeat {
    atom;
    min;
    max;
    constructor(atom, min, max) {
        this.atom = atom;
        this.min = min;
        this.max = max;
    }
    get inner() {
        return this.atom instanceof P ? this.atom.atom : this.atom;
    }
    _match(ctx) {
        const results = [];
        let count = 0;
        while (count < this.max) {
            const r = attempt(ctx, () => this.inner._match(ctx));
            if (r === undefined)
                break;
            results.push(r);
            count++;
            if (ctx.pos >= ctx.input.length && count < this.min)
                break;
        }
        if (count < this.min) {
            throw new Fail(`Expected at least ${this.min} of repetition`);
        }
        if (results.some((r) => typeof r === "object"))
            return results;
        return results.join("");
    }
}
class Maybe {
    atom;
    constructor(atom) {
        this.atom = atom;
    }
    _match(ctx) {
        const inner = this.atom instanceof P ? this.atom.atom : this.atom;
        const r = attempt(ctx, () => inner._match(ctx));
        if (r === undefined || r === "")
            return undefined;
        return r;
    }
}
class As {
    atom;
    key;
    constructor(atom, key) {
        this.atom = atom;
        this.key = key;
    }
    get inner() {
        return this.atom instanceof P ? this.atom.atom : this.atom;
    }
    _match(ctx) {
        const r = this.inner._match(ctx);
        return { [this.key]: r === undefined ? null : r };
    }
}
class Absent {
    atom;
    constructor(atom) {
        this.atom = atom;
    }
    _match(ctx) {
        const inner = this.atom instanceof P ? this.atom.atom : this.atom;
        const r = attempt(ctx, () => inner._match(ctx));
        if (r !== undefined)
            throw new Fail("unexpectedly matched");
        return "";
    }
}
class Present {
    atom;
    constructor(atom) {
        this.atom = atom;
    }
    _match(ctx) {
        const inner = this.atom instanceof P ? this.atom.atom : this.atom;
        attempt(ctx, () => inner._match(ctx));
        return "";
    }
}
class Ref {
    rules;
    name;
    resolved;
    constructor(rules, name) {
        this.rules = rules;
        this.name = name;
    }
    _match(ctx) {
        if (!this.resolved) {
            const rule = this.rules[this.name];
            if (!rule)
                throw new Error(`unknown rule :${this.name}`);
            this.resolved = rule instanceof P ? rule.atom : rule;
        }
        return this.resolved._match(ctx);
    }
}
/** Builder-side sugar: chainable wrapper. */
export class P {
    atom;
    constructor(atom) {
        this.atom = atom;
    }
    then(...next) {
        return new P(new Seq([this.atom, ...next.map(unwrap)]));
    }
    or(...others) {
        return new P(new Alt([this.atom, ...others.map(unwrap)]));
    }
    repeat(min = 0, max = Infinity) {
        return new P(new Repeat(this.atom, min, max));
    }
    maybe() {
        return new P(new Maybe(this.atom));
    }
    as(key) {
        return new P(new As(this.atom, key));
    }
    absent() {
        return new P(new Absent(this.atom));
    }
    present() {
        return new P(new Present(this.atom));
    }
}
export function unwrap(p) {
    return p instanceof P ? p.atom : p;
}
export function str(s) {
    return new P(new Str(s));
}
/** parslet's match: a single-character regex match, e.g. match("[a-z]"). */
export function match(pattern) {
    return new P(new Regex(pattern));
}
/** A named rule reference (lazily resolved — grammars are recursive). */
export function ref(rules, name) {
    return new P(new Ref(rules, name));
}
/**
 * Parse the whole input with the grammar's root rule, parslet-style:
 * failure to consume everything raises ParseFailed.
 */
export function parseGrammar(grammar, input) {
    const ctx = new Ctx(input);
    const root = new Ref(grammar.rules, grammar.root);
    const result = root._match(ctx);
    if (result === undefined || ctx.pos !== input.length) {
        throw new ParseFailed(`Expected one of [${grammar.root.toUpperCase()}]`, ctx.pos);
    }
    return result;
}
