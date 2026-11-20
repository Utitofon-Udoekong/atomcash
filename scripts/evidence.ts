import { readFileSync } from "node:fs";

for (const name of ["claim.json", "refund.json", "broken-byte.json", "atomic.json"]) {
  const json = JSON.parse(readFileSync(new URL(`../evidence/${name}`, import.meta.url), "utf8")) as Record<string, string>;
  const ids = Object.entries(json).filter(([key]) => key.toLowerCase().includes("txid"));
  for (const [key, value] of ids) {
    console.log(`${name} ${key} ${value}`);
  }
}
