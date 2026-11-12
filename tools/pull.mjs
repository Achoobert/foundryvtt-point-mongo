/**
 * Pulls the full Point Mongo codex into data/raw/ (gitignored).
 * Needs PM_API_KEY in .env. Usage: npm run pull
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "data", "raw");
const BASE = "https://pointmongo.com/api/v1";

process.loadEnvFile?.(path.join(ROOT, ".env"));
const KEY = process.env.PM_API_KEY;
if (!KEY) throw new Error("PM_API_KEY not set (.env)");

async function get(url) {
  for (;;) {
    const res = await fetch(BASE + url, { headers: { "X-Api-Key": KEY } });
    if (res.status === 429) {
      const wait = Number(res.headers.get("retry-after") ?? 10);
      console.log(`rate limited, waiting ${wait}s`);
      await new Promise((r) => setTimeout(r, wait * 1000));
      continue;
    }
    if (!res.ok) throw new Error(`${res.status} ${url}: ${await res.text()}`);
    return res.json();
  }
}

async function getAll(url) {
  const items = [];
  for (let page = 1; ; page++) {
    const sep = url.includes("?") ? "&" : "?";
    const data = await get(`${url}${sep}page=${page}&pageSize=200`);
    items.push(...data.items);
    if (page >= data.totalPages) return items;
  }
}

fs.mkdirSync(OUT, { recursive: true });
const pulledAt = new Date().toISOString();
const categories = (await get("/categories")).items;
const entries = await getAll("/entries");
fs.writeFileSync(path.join(OUT, "categories.json"), JSON.stringify(categories, null, 2));
fs.writeFileSync(path.join(OUT, "entries.json"), JSON.stringify(entries, null, 2));
fs.writeFileSync(
  path.join(OUT, "meta.json"),
  JSON.stringify({ pulledAt, count: entries.length }, null, 2),
);
console.log(`Pulled ${entries.length} entries, ${categories.length} categories`);
