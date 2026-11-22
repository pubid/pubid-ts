import { ParseFailed } from "../../grammar/engine.js";
import { PubidRuntime } from "../../parg/runtime.js";
import type { FlavorImplementation, Identifier } from "../../conformance/implementation.js";
import { Publisher, PubidDate, Language } from "../../model/component.js";
import { AnsiIdentifier, AnsiStandard } from "./model.js";

export * from "./model.js";

/**
 * The ansi parse entry — the same baked artifact the Ruby flavor runs
 * (pubid data/parg/ansi.json, sealed at parsanol 1.5.1.0; the gem's
 * artifact runs AHEAD of the pubid-grammar checkout, the known
 * artifact-ahead-of-source drift), loaded through the artifact runtime.
 * The builder mirrors Pubid::Ansi::Builder: the grammar checks the
 * shape, this side splits the number group on dashes and reclassifies a
 * trailing dash-year.
 */

// --- Builder (lib/pubid/ansi/builder.rb) -------------------------------------

/**
 * A trailing "-" + 4 digits (19xx/20xx) is the publication year, not a
 * part: "ANSI X9.62-2005" (relaton#45). Only when no ":YYYY" follows,
 * so the part of "ANSI X9.8-1:2007" stays a part.
 */
const DASH_YEAR = /^(?:19|20)\d{2}$/;

/**
 * Ruby Builder split_number_with_part: a third dash group is always the
 * year ("ANSI/ISA-61511-1-2018") — the grammar admits only a 19xx/20xx
 * group there. At most one part group reaches the tree, so three
 * segments is the maximum.
 */
function splitNumberWithPart(value: string): Record<string, unknown> {
  const segments = value.split("-");
  const [number, part, dashYear] = segments;
  const attrs: Record<string, unknown> = {};
  if (number !== undefined) attrs["number"] = number;
  if (part !== undefined) attrs["part"] = part;
  if (dashYear !== undefined) {
    attrs["date"] = new PubidDate({ year: dashYear });
    attrs["date_separator"] = "-";
  }
  return attrs;
}

/**
 * read_dash_year: a trailing "-" + 4 digits is the publication year,
 * not a part — unless a date or a revision already claimed the slot (a
 * revision follows the part, so "568-2009-D" keeps 2009 as a part:
 * read as a year, it would render after the revision).
 */
function readDashYear(identifier: AnsiIdentifier): void {
  const record = identifier as unknown as Record<string, unknown>;
  if (record["date"] !== undefined || record["revision"] !== undefined) return;
  const part = record["part"];
  if (typeof part !== "string" || !DASH_YEAR.test(part)) return;
  record["date"] = new PubidDate({ year: part });
  record["date_separator"] = "-";
  record["part"] = undefined;
}

function buildAnsi(data: Record<string, unknown>): AnsiIdentifier {
  const attrs: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined || value === null) continue;
    switch (key) {
      case "publisher":
        attrs["publisher"] = new Publisher({ body: String(value) });
        break;
      case "std_keyword":
        // Consumed and dropped: no identifier attribute reads it.
        break;
      case "copublishers": {
        const list = Array.isArray(value) ? value : [value];
        if (list.length === 0) break;
        attrs["copublishers"] = list.map((entry) => {
          const body = typeof entry === "object" && entry !== null && "copublisher" in entry
            ? String((entry as Record<string, unknown>)["copublisher"])
            : String(entry);
          return new Publisher({ body });
        });
        break;
      }
      case "number_with_part":
        Object.assign(attrs, splitNumberWithPart(String(value)));
        break;
      case "number_separator":
      case "revision":
        attrs[key] = String(value);
        break;
      case "date":
        attrs["date"] = new PubidDate({ year: String(value) });
        break;
      case "languages":
        attrs["languages"] = String(value)
          .split(",")
          .map((lang) => new Language({ code: lang.trim() }));
        break;
      default:
        // Unknown captures raise in the Ruby builder; the grammar binds
        // exactly the keys above, so this is unreachable today.
        throw new Error(`Unknown parameter type: ${key}`);
    }
  }
  const identifier = new AnsiStandard(attrs);
  readDashYear(identifier);
  return identifier;
}

// --- Implementation ----------------------------------------------------------

let cachedRuntime: ReturnType<typeof PubidRuntime.load> | undefined;

export function ansiGrammarImplementation(): FlavorImplementation {
  return {
    parse(input: string): Identifier {
      cachedRuntime ??= PubidRuntime.load("ansi");
      const bound = cachedRuntime.parseAndBind(input);
      if (bound === null || typeof bound !== "object" || Array.isArray(bound)) {
        throw new ParseFailed("ansi: the artifact rejected the input", 0);
      }
      return buildAnsi(bound as Record<string, unknown>) as unknown as Identifier;
    },
  };
}
