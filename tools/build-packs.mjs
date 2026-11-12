/**
 * Compiles src/packs/<pack>/*.yml into the LevelDB packs declared in
 * module.json, using @foundryvtt/foundryvtt-cli.
 *
 * Usage: npm run build:packs
 */
import { compilePack } from "@foundryvtt/foundryvtt-cli";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "module.json"), "utf8"));

for (const pack of manifest.packs) {
  const src = path.join(ROOT, "src", "packs", pack.name);
  const dest = path.join(ROOT, pack.path);
  fs.rmSync(dest, { recursive: true, force: true });
  await compilePack(src, dest, { yaml: true });
  console.log(`Compiled ${pack.name} -> ${pack.path}`);
}
