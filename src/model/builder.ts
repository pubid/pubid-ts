/**
 * BaseBuilder — the TS mirror of Pubid::Builder::Base
 * (TODO.unified/01 §5). The shared build loop: flatten the parslet tree
 * (array of hashes → merged hash), ask selectClass for the concrete
 * class, then assign each tree key through cast(); unknown keys are
 * silently skipped; cast may return a hash to fan out.
 */

import type { BaseIdentifier } from "./identifier.js";
import type { IdentifierStatic } from "./identifier.js";
import { PubidDate } from "./component.js";
import { Language } from "./component.js";

type TreeValue = unknown;

export abstract class BaseBuilder {
  protected abstract defaultIdentifierClass(): IdentifierStatic;

  /** Override to dispatch by data shape (type token, supplement marker…). */
  protected selectClass(_data: Record<string, TreeValue>): IdentifierStatic {
    return this.defaultIdentifierClass();
  }

  /**
   * Override to convert raw parsed values to components. Return a hash to
   * assign multiple attributes, a single value, or null/undefined to skip.
   */
  protected cast(_key: string, value: TreeValue): TreeValue {
    return value;
  }

  /** Override for non-attribute side effects; return true when consumed. */
  protected handleKey(_identifier: BaseIdentifier, _key: string, _value: TreeValue): boolean {
    return false;
  }

  build(data: Record<string, TreeValue> | Record<string, TreeValue>[]): BaseIdentifier {
    const flat = this.flattenArray(data);
    const IdentifierClass = this.selectClass(flat);
    const identifier = new IdentifierClass();
    this.assignAttributes(identifier, flat);
    return identifier;
  }

  private flattenArray(data: Record<string, TreeValue> | Record<string, TreeValue>[]): Record<string, TreeValue> {
    if (Array.isArray(data)) {
      return Object.assign({}, ...data);
    }
    return data;
  }

  private assignAttributes(identifier: BaseIdentifier, data: Record<string, TreeValue>): void {
    const attrs = identifier.constructor.attributes;
    for (const [key, value] of Object.entries(data)) {
      const realized = this.cast(key, value);
      if (realized === null || realized === undefined) continue;
      if (this.handleKey(identifier, key, realized)) continue;
      const target = identifier as unknown as Record<string, unknown>;
      if (typeof realized === "object" && !Array.isArray(realized)) {
        for (const [k, v] of Object.entries(realized as Record<string, unknown>)) {
          if (k in attrs) target[k] = v;
        }
      } else if (key in attrs) {
        target[key] = realized;
      }
    }
  }

  // Shared helpers (Builder::Base private API).

  protected parseDate(value: unknown): PubidDate {
    const str = String(value);
    const m = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/.exec(str);
    if (m) {
      return new PubidDate({ year: m[1], month: m[2], day: m[3] });
    }
    if (/^\d{4}$/.test(str)) return new PubidDate({ year: str });
    throw new Error(`Invalid date format: ${str}`);
  }

  protected parseLanguages(value: unknown): Language[] {
    return String(value)
      .replaceAll("/", ",")
      .split(",")
      .map((lang) => {
        const original = lang.trim();
        const code = Language.CHAR_MAP[original] ?? original;
        return new Language({ code, originalCode: original });
      });
  }

  private static readonly ROMAN: Record<string, number> = {
    I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000,
  };

  protected convertRomanToInteger(roman: unknown): string {
    const str = String(roman);
    if (!/^[IVXLCDM]+$/i.test(str)) return str;
    let result = 0;
    let prev = 0;
    for (const char of str.toUpperCase().split("").reverse()) {
      const value = BaseBuilder.ROMAN[char]!;
      result += value < prev ? -value : value;
      prev = value;
    }
    return String(result);
  }

  /**
   * "1234-1-2" → {number, part?, subpart?}; roman parts convert to
   * integers; normalizeNumberWithPart / extractLegacyYear are hooks.
   */
  protected parseNumberWithPart(value: unknown): Record<string, string | undefined> {
    const normalized = this.normalizeNumberWithPart(String(value));
    const parts = normalized.split("-").filter((p) => p !== "");
    const number = parts.shift();
    let part = parts.shift()?.trim();
    const subpart = parts.length > 0 ? parts.join("-") : undefined;
    const legacy = this.extractLegacyYear(number, part);
    if (legacy) return legacy;
    if (part !== undefined) part = this.convertRomanToInteger(part);
    const out: Record<string, string | undefined> = { number };
    if (part !== undefined) out["part"] = part;
    if (subpart !== undefined) out["subpart"] = subpart;
    return out;
  }

  protected normalizeNumberWithPart(value: string): string {
    return value;
  }

  protected extractLegacyYear(_number: string | undefined, _part: string | undefined): Record<string, string | undefined> | undefined {
    return undefined;
  }
}
