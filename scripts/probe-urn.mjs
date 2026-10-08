import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { grammarImplementation } from "../dist/flavors/index.js";
const doc = JSON.parse(gunzipSync(readFileSync("test/fixtures/urn-parity.json.gz")));
const impl = grammarImplementation("ieee");
for (const row of doc["ieee"]) {
  if (row["human"] === undefined) continue;
  let got;
  try {
    got = impl.parse(row["urn"]).toHuman();
  } catch (e) {
    got = `error(${e.message.slice(0, 40)})`;
  }
  if (got !== row["human"]) console.log(`${row["urn"]}: ts=${JSON.stringify(got)} fixture=${JSON.stringify(row["human"])}`);
}
console.log("done");
