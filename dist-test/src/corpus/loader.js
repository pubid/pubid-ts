import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
function loadPayload(path) {
    const doc = parseYaml(readFileSync(path, "utf8"));
    return Array.isArray(doc) ? doc : [];
}
function loadStatus(dir) {
    const path = join(dir, "_status.yaml");
    if (!existsSync(path)) {
        throw new Error(`missing _status.yaml in ${dir} - every flavor has one`);
    }
    const doc = parseYaml(readFileSync(path, "utf8"));
    if (typeof doc.clean !== "boolean") {
        throw new Error(`malformed _status.yaml in ${dir}: clean must be boolean`);
    }
    return doc;
}
/**
 * Load the pubid-testsuite corpus. The corpus is the single source of
 * truth for identifier behavior; this loader never edits it (the
 * cross-repo law: schema/corpus changes land in pubid Ruby PRs first).
 *
 * @param testsDir path to a pubid-testsuite checkout's tests/ directory
 */
export function loadCorpus(testsDir) {
    if (!existsSync(testsDir)) {
        throw new Error(`corpus not found at ${testsDir} - refusing to report vacuous success`);
    }
    const flavors = new Map();
    for (const entry of readdirSync(testsDir).sort()) {
        const dir = join(testsDir, entry);
        if (!statSync(dir).isDirectory())
            continue;
        const payloads = {
            cases: [],
            negatives: [],
            debt: [],
            status: loadStatus(dir),
        };
        for (const file of readdirSync(dir).sort()) {
            if (!file.endsWith(".yaml"))
                continue;
            const rows = loadPayload(join(dir, file));
            if (file === "_negative.yaml")
                payloads.negatives = rows;
            else if (file === "_debt.yaml")
                payloads.debt = rows;
            else if (!file.startsWith("_"))
                payloads.cases.push(...rows);
        }
        flavors.set(entry, payloads);
    }
    if (flavors.size === 0) {
        throw new Error(`no flavor payloads under ${testsDir} - refusing to report vacuous success`);
    }
    return { flavors };
}
