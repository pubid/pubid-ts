/**
 * The error classes of the pubid-scheme URN codec — the TS mirror of
 * Pubid::Errors::UrnParseError and Pubid::Errors::InvalidInputError
 * (lib/pubid/errors.rb). A decode failure is ALWAYS one of these two,
 * never a parser-internal error (pubid#670 item 3).
 */

/** A malformed, unknown or non-canonical pubid-scheme URN (ruby:
 *  UrnParseError < StandardError). */
export class UrnParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UrnParseError";
  }
}

/** A non-String or over-long input (ruby: InvalidInputError < ArgumentError). */
export class InvalidInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidInputError";
  }
}
