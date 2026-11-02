import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { grammarImplementation } from "../dist/flavors/index.js";
const doc = JSON.parse(gunzipSync(readFileSync("test/fixtures/urn-parity.json.gz")));
const impl = grammarImplementation("iec");
let n = 0;
for (const row of doc["iec"]) {
  if (row["human"] === undefined) continue;
  let got;
  try {
    got = impl.parseUrn(row["urn"]).toHuman();
  } catch (e) {
    got = `error(${e.message.slice(0, 60)})`;
  }
  if (got !== row["human"]) { n++; console.log(`URN ${row["urn"]}\n  ts=${JSON.stringify(got)}\n  fx=${JSON.stringify(row["human"])}`); }
}
console.log(`done: ${n} mismatched rows`);
