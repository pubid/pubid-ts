import { readFileSync, existsSync } from "node:fs";
import { parse as parseYaml } from "yaml";
/**
 * The pending registry mirrors the Ruby format exactly
 * (conformance/pending.yaml in the reference): cases this port
 * explicitly cannot handle yet. A pending case that PASSES raises the
 * pending-satisfied alarm - the marker must then be removed, never left
 * to rot while the case actually passes.
 */
export class PendingRegistry {
    entries = new Map();
    static load(path) {
        const registry = new PendingRegistry();
        if (!existsSync(path))
            return registry;
        const doc = parseYaml(readFileSync(path, "utf8"));
        for (const [id, entry] of Object.entries(doc ?? {})) {
            if (!entry?.reason || !entry?.ref) {
                throw new Error(`pending entry ${id} needs reason + ref (same format as the Ruby reference)`);
            }
            registry.entries.set(id, { reason: entry.reason, ref: entry.ref });
        }
        return registry;
    }
    has(id) {
        return this.entries.has(id);
    }
    get size() {
        return this.entries.size;
    }
}
