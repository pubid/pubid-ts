/**
 * The unified model's Components — the TS mirror of lib/pubid/components/.
 * Semantics pinned in TODO.unified/01-study-pubid-core.md §6-7.
 *
 * Every component carries: plain fields, `render(context)` (the
 * RenderingContext seam: "human" default, "urn" lowercases / year-only),
 * `toWire()` (its serialized hash form), and degenerate-scalar support
 * (a component holding only its single significant field collapses to
 * that scalar in the canonical hash).
 */

export type RenderContext = "human" | "urn";

/** Render a value that may be a component or a bare scalar (Renderers::Base#render_component). */
export function renderComponent(value: unknown, context?: RenderContext): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (value instanceof Component) return value.render(context);
  return String(value);
}

export abstract class Component {
  /** The serialized hash form (lutaml to_hash of the component). */
  abstract toWire(): Record<string, unknown>;

  /** The render seam (context: human default, urn lowercases etc.). */
  abstract render(context?: RenderContext): string | undefined;

  /**
   * The scalar this component degenerates to when `field` is its only
   * significant value, else undefined (Pubid::Identifier#degenerate_scalar).
   * A field holding another component never degenerates.
   */
  degenerateScalar(field: string): string | undefined {
    let found: string | undefined;
    for (const [name, value] of Object.entries(this)) {
      if (value === undefined || value === null || value === "") continue;
      if (this.fieldIsDefaulted(name, value)) continue;
      if (name === field) {
        if (value instanceof Component) return undefined;
        found = String(value);
      } else {
        return undefined;
      }
    }
    return found;
  }

  /** True when `value` equals the field's declared default. */
  protected fieldIsDefaulted(_name: string, _value: unknown): boolean {
    return false;
  }
}

const pad2 = (value: string): string => value.padStart(2, "0");

/** Publication date (Components::Date). Human "YYYY[-MM[-DD]]", URN year only, "--" undated. */
export class PubidDate extends Component {
  readonly year?: string | undefined;
  readonly month?: string | undefined;
  readonly day?: string | undefined;
  readonly undated: boolean;

  constructor(attrs: Record<string, unknown>) {
    super();
    this.year = attrs["year"] as string | undefined;
    this.month = attrs["month"] as string | undefined;
    this.day = attrs["day"] as string | undefined;
    this.undated = (attrs["undated"] as boolean | undefined) ?? false;
  }

  present(): boolean {
    if (this.undated) return true;
    return this.year !== undefined && this.year !== "";
  }

  render(context?: RenderContext): string | undefined {
    if (this.undated && (this.year === undefined || this.year === "")) return "--";
    if (!this.present()) return undefined;
    if (context === "urn") return this.year;
    if (this.month === undefined) return this.year;
    let result = `${this.year}-${pad2(this.month)}`;
    if (this.day !== undefined) result += `-${pad2(this.day)}`;
    return result;
  }

  toWire(): Record<string, unknown> {
    const wire: Record<string, unknown> = {};
    if (this.year !== undefined) wire["year"] = this.year;
    if (this.month !== undefined) wire["month"] = this.month;
    if (this.day !== undefined) wire["day"] = this.day;
    if (this.undated) wire["undated"] = true;
    return wire;
  }

  protected fieldIsDefaulted(name: string, value: unknown): boolean {
    return name === "undated" && value === false;
  }
}

/** Publisher (Components::Publisher): body; URN render lowercases. */
export class Publisher extends Component {
  readonly body: string;

  constructor(attrs: Record<string, unknown>) {
    super();
    this.body = attrs["body"] as string;
  }

  render(context?: RenderContext): string {
    return context === "urn" ? this.body.toLowerCase() : this.body;
  }

  toWire(): Record<string, unknown> {
    return { body: this.body };
  }
}

/** Language (Components::Language): single-char CHAR_MAP codes; URN lowercases. */
export class Language extends Component {
  static readonly CHAR_MAP: Record<string, string> = {
    R: "ru",
    F: "fr",
    E: "en",
    A: "ar",
    S: "es",
    D: "de",
  };

  readonly code: string;
  readonly originalCode?: string | undefined;

  constructor(attrs: Record<string, unknown>) {
    super();
    this.code = attrs["code"] as string;
    this.originalCode = (attrs["originalCode"] ?? attrs["original_code"]) as string | undefined;
  }

  render(context?: RenderContext): string {
    if (context === "urn") return this.code.toLowerCase();
    if (this.originalCode !== undefined) {
      return this.originalCode.length === 1 ? this.code : this.originalCode;
    }
    return this.code;
  }

  toWire(): Record<string, unknown> {
    return this.originalCode === undefined ? { code: this.code } : { code: this.code, original_code: this.originalCode };
  }
}

/** Edition (Components::Edition): degenerates to its number. */
export class Edition extends Component {
  readonly number: string;
  readonly phase?: string | undefined;

  constructor(attrs: Record<string, unknown>) {
    super();
    this.number = attrs["number"] as string;
    this.phase = attrs["phase"] as string | undefined;
  }

  render(context?: RenderContext): string | undefined {
    void context;
    return this.phase === undefined ? this.number : `${this.number}${this.phase}`;
  }

  toWire(): Record<string, unknown> {
    return this.phase === undefined ? { number: this.number } : { number: this.number, phase: this.phase };
  }
}

/** Iteration (Components::Iteration): degenerate by construction. */
export class Iteration extends Component {
  readonly string: string;

  constructor(attrs: Record<string, unknown>) {
    super();
    this.string = attrs["string"] as string;
  }

  render(_context?: RenderContext): string | undefined {
    return this.string;
  }

  toWire(): Record<string, unknown> {
    return { string: this.string };
  }
}
