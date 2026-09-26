/* tslint:disable */
/* eslint-disable */

/**
 * A verified PG artifact exposed to JavaScript: checksum-verified load,
 * native parse, bindings application, embedded-suite runs and the
 * binding-requirements schema (PN 2/4).
 */
export class PgArtifactJs {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Apply an entry's bindings to a parsanol-shape tree (JSON text).
     */
    applyBindings(entry: string, shape_json: string): string;
    /**
     * Declared entry point names, sorted.
     */
    entryNames(): string[];
    /**
     * Load and checksum-verify an artifact envelope.
     */
    constructor(artifact_json: string);
    /**
     * Parse and bind in one step.
     */
    parseAndBind(entry: string, input: string): string;
    /**
     * Parse an entry with the native engine; returns the parsanol-shape
     * tree as JSON text.
     */
    parseShape(entry: string, input: string): string;
    /**
     * Run the artifact's embedded tests; returns the failure list as
     * JSON (empty array means green).
     */
    runTests(): string;
    /**
     * The binding-requirements schema as JSON text.
     */
    schema(): string;
    /**
     * The binding-requirements schema as TypeScript source.
     */
    schemaTypescript(): string;
}

/**
 * WASM parser instance
 *
 * Create with `new WasmParser(grammarJson)` and parse with `parse(input)`.
 */
export class WasmParser {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Create a new parser from a PG artifact envelope and entry name.
     *
     * The artifact's canonical checksum is verified before any parsing;
     * a mismatched or corrupt artifact is rejected (PN 2).
     *
     * # Arguments
     * * `artifact_json` - JSON text of the PG artifact envelope
     * * `entry` - entry point name declared in the artifact
     */
    static fromArtifact(artifact_json: string, entry: string): WasmParser;
    /**
     * Create a new parser from grammar JSON
     *
     * # Arguments
     * * `grammar_json` - JSON string representing the grammar
     *
     * # Returns
     * A new WasmParser instance
     *
     * # Throws
     * If the grammar JSON is invalid
     */
    constructor(grammar_json: string);
    /**
     * Parse input and return JavaScript AST
     *
     * # Arguments
     * * `input` - The input string to parse
     *
     * # Returns
     * A JavaScript object representing the parsed AST
     *
     * # Throws
     * If parsing fails
     */
    parse(input: string): any;
    /**
     * Parse and return flat array (for Opal compatibility)
     *
     * # Arguments
     * * `input` - The input string to parse
     *
     * # Returns
     * A Uint32Array containing the flattened AST
     *
     * # Throws
     * If parsing fails
     */
    parse_flat(input: string): BigUint64Array;
    /**
     * Parse and return JSON string
     *
     * # Arguments
     * * `input` - The input string to parse
     *
     * # Returns
     * A JSON string representing the parsed AST
     *
     * # Throws
     * If parsing fails
     */
    parse_json(input: string): string;
}

/**
 * Initialize function for WASM
 */
export function init(): void;
