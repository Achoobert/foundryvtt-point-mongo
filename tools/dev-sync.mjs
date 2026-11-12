/**
 * Copies the runtime parts of the module into the Foundry user data folder
 * from fvtt.config.js (Data/modules/<id>), so a running Foundry picks up
 * local edits after a world reload.
 *
 * Usage: npm run dev:sync   (run build first, or use npm run dev)
 */
import { cp, mkdir, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DATA_DIR } from "./lib/fvtt-config.mjs";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const manifest = JSON.parse(await readFile(path.join(ROOT, "module.json"), "utf8"));
const TARGET = path.join(DATA_DIR, "modules", manifest.id);

const ENTRIES_TO_SYNC = ["module.json", "README.md", "LICENSE", "LICENSE.txt", "packs"];

await mkdir(TARGET, { recursive: true });

for (const entry of ENTRIES_TO_SYNC) {
  const source = path.join(ROOT, entry);
  if (!existsSync(source)) continue;
  const dest = path.join(TARGET, entry);
  // Packs are LevelDB folders; replace them whole so stale .ldb files don't linger.
  if (entry === "packs") await rm(dest, { recursive: true, force: true });
  await cp(source, dest, { recursive: true, force: true });
  console.log(`Synced ${entry} -> ${TARGET}`);
}

console.log(`\nModule deployed to ${TARGET}`);
console.log("Reload the world (or restart Foundry if packs changed while it held them open).");
