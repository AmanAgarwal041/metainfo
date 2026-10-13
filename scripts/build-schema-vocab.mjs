// Compile the schema.org vocabulary into the compact table the Rust validator
// embeds (wasm/src/schema_vocab.json). Run when bumping the schema.org release:
//   node scripts/build-schema-vocab.mjs [version]
// The output is committed so normal builds never need the network.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const VERSION = process.argv[2] ?? "30.1";
const SRC = `https://raw.githubusercontent.com/schemaorg/schemaorg/main/data/releases/${VERSION}/schemaorg-current-https.jsonld`;
const root = fileURLToPath(new URL("..", import.meta.url));

const res = await fetch(SRC);
if (!res.ok) throw new Error(`Couldn't download schema.org ${VERSION}: HTTP ${res.status}`);
const graph = (await res.json())["@graph"];

const name = (id) => (typeof id === "string" ? id.replace(/^schema:/, "") : null);
const ids = (v) => (v == null ? [] : (Array.isArray(v) ? v : [v]).map((x) => name(x["@id"] ?? x)).filter(Boolean));
const types = (n) => (Array.isArray(n["@type"]) ? n["@type"] : [n["@type"]]);
const isSchema = (n) => typeof n["@id"] === "string" && n["@id"].startsWith("schema:");

const classes = {}; // class -> direct parents
const props = {}; // property -> { d: domains, r: ranges, s?: supersededBy }
const members = {}; // enumeration member -> its enumeration class
const superseded = {}; // class -> replacement
const dataTypes = new Set();

for (const n of graph) {
  if (!isSchema(n)) continue;
  const id = name(n["@id"]);
  const t = types(n);
  if (t.includes("rdfs:Class")) {
    classes[id] = ids(n["rdfs:subClassOf"]);
    if (t.includes("schema:DataType")) dataTypes.add(id);
    const sup = ids(n["schema:supersededBy"])[0];
    if (sup) superseded[id] = sup;
  } else if (t.includes("rdf:Property")) {
    const p = { d: ids(n["schema:domainIncludes"]), r: ids(n["schema:rangeIncludes"]) };
    const sup = ids(n["schema:supersededBy"])[0];
    if (sup) p.s = sup;
    props[id] = p;
  } else {
    // An instance of a schema.org class: enumeration members (InStock, Monday, ...).
    const cls = t.map(name).find((c) => c && c !== "rdfs:Class");
    if (cls) members[id] = cls;
  }
}

// DataType subclasses (URL is a Text, Integer a Number, ...) are data types too.
let grew = true;
while (grew) {
  grew = false;
  for (const [c, parents] of Object.entries(classes)) {
    if (!dataTypes.has(c) && parents.some((p) => dataTypes.has(p))) {
      dataTypes.add(c);
      grew = true;
    }
  }
}

const out = { v: VERSION, c: classes, p: props, m: members, s: superseded, dt: [...dataTypes].sort() };
const json = JSON.stringify(out);
writeFileSync(`${root}/wasm/src/schema_vocab.json`, json + "\n");
console.log(`schema.org ${VERSION}: ${Object.keys(classes).length} classes, ${Object.keys(props).length} properties, ${Object.keys(members).length} enumeration members, ${dataTypes.size} data types -> ${(json.length / 1024).toFixed(0)} KB`);
