/**
 * BaseUrnGenerator — the TS mirror of Pubid::UrnGenerator::Base
 * (TODO.unified/01 §4). Flavors with a Ruby `urn_generator.rb` subclass
 * and override hooks; flavors without one (doi, isbn, omg, un, gb) use
 * this template directly, and the parts are derived from their declared
 * attributes — never hand-assembled per flavor.
 */

import type { BaseIdentifier } from "./identifier.js";
import { renderComponent } from "./component.js";
import type { RenderContext } from "./component.js";

type UrnableIdentifier = BaseIdentifier;

export class BaseUrnGenerator<T extends UrnableIdentifier = UrnableIdentifier> {
  constructor(protected readonly identifier: T) {}

  generate(): string {
    const parts = ["urn", this.urnNamespace()];
    const push = (v: string | undefined) => {
      if (v !== undefined && v !== null && v !== "") parts.push(v);
    };
    push(this.urnPublisher());
    push(this.urnType());
    push(this.urnNumber());
    push(this.urnPart());
    push(this.urnSubpart());
    push(this.urnYear());
    push(this.urnEdition());
    push(this.urnLanguage());
    return parts.join(":");
  }

  /** Template methods — override in subclasses (Ruby precedent). */

  protected urnNamespace(): string {
    // Pubid::<Flavor>::… → flavor name downcased; derived from _type.
    const [, flavor] = this.identifier.constructor.polymorphicName.split(":");
    return flavor ?? "unknown";
  }

  /** Reads a DECLARED attribute only (Base#maybe) — constants never appear. */
  protected maybe(name: string): unknown {
    const attributes = this.identifier.constructor.attributes;
    if (!attributes || !(name in attributes)) return undefined;
    return (this.identifier as unknown as Record<string, unknown>)[name];
  }

  protected urnPublisher(): string | undefined {
    const pub = this.maybe("publisher");
    if (pub === undefined || pub === null) return undefined;
    return renderComponent(pub, "urn" as RenderContext);
  }

  protected urnType(): string | undefined {
    return undefined;
  }

  protected urnNumber(): string | undefined {
    const val = this.maybe("number") ?? this.maybe("code");
    return val === undefined || val === null ? undefined : renderComponent(val, "urn" as RenderContext);
  }

  protected urnPart(): string | undefined {
    const val = this.maybe("part");
    return val === undefined || val === null ? undefined : `-${renderComponent(val, "urn" as RenderContext)}`;
  }

  protected urnSubpart(): string | undefined {
    const val = this.maybe("subpart");
    return val === undefined || val === null ? undefined : `-${renderComponent(val, "urn" as RenderContext)}`;
  }

  protected urnYear(): string | undefined {
    const date = this.maybe("date");
    if (date !== undefined && date !== null && typeof date === "object" && "render" in (date as object)) {
      const rendered = (date as { render(ctx?: string): string | undefined }).render("urn");
      return rendered ?? undefined;
    }
    if (date !== undefined && date !== null) return String(date);
    const year = this.maybe("year");
    return year === undefined || year === null ? undefined : String(year);
  }

  protected urnEdition(): string | undefined {
    const ed = this.maybe("edition");
    if (ed === undefined || ed === null) return undefined;
    const num = typeof ed === "object" && "number" in (ed as object) ? (ed as { number?: string }).number : ed;
    return num === undefined || num === null || num === "" ? undefined : `ed.${String(num)}`;
  }

  protected urnLanguage(): string | undefined {
    const langs = this.maybe("languages");
    if (!Array.isArray(langs) || langs.length === 0) return undefined;
    return langs
      .map((l) => renderComponent(l, "urn" as RenderContext))
      .filter((s): s is string => s !== undefined)
      .join(",");
  }
}
