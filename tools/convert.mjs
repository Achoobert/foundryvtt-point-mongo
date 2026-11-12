/**
 * Converts data/raw/entries.json (from tools/pull.mjs) into one YAML source
 * file per document under src/packs/<pack>/, shaped for the carl-rpg system's
 * data models. Wipes and regenerates src/packs each run, so an entry dropped
 * from the codex drops out of the packs too.
 *
 * Usage: npm run convert
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "js-yaml";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const RAW = path.join(ROOT, "data", "raw");
const OUT = path.join(ROOT, "src", "packs");
const MODULE_ID = "point-mongo";

const STATS = ["str", "dex", "con", "int", "cha"];
const DAMAGE_TYPES = [
  "acid",
  "bludgeoning",
  "electric",
  "fire",
  "force",
  "holy",
  "ice",
  "necrotic",
  "piercing",
  "poison",
  "psychic",
  "slashing",
];
const SIZES = {
  1: "Tiny",
  2: "Small",
  3: "Petite",
  4: "Medium",
  5: "Large",
  6: "Huge",
  7: "Colossal",
  8: "Gargantuan",
};
// Table 50 hbSlotsBase, added to the Floor for a Boss's HB slot count.
const BOSS_HB_BASE = {
  neighborhood: 10,
  borough: 15,
  city: 20,
  province: 25,
  country: 30,
  floor: 40,
};

// Which pack each codex category lands in. Anything not listed (and every
// entry with a null kind) goes to the codex journal.
const PACKS = {
  bestiary: {
    type: "Actor",
    label: "Bestiary",
    categories: ["mobs", "bosses", "npcs", "feral-gods"],
  },
  "skills-and-spells": { type: "Item", label: "Skills & Spells", categories: ["skills", "spells"] },
  "classes-and-races": { type: "Item", label: "Classes & Races", categories: ["classes", "races"] },
  gear: {
    type: "Item",
    label: "Gear & Loot",
    categories: [
      "loot",
      "magic-items",
      "magical-jewelry",
      "magical-weapons",
      "potions",
      "crafting",
    ],
  },
  codex: { type: "JournalEntry", label: "Codex" },
};
const COLLECTION = { Actor: "actors", Item: "items", JournalEntry: "journal" };

const DEFAULT_IMG = {
  creature: "icons/svg/mystery-man.svg",
  spell: "icons/svg/explosion.svg",
  skill: "icons/svg/book.svg",
  gear: "icons/svg/item-bag.svg",
  race: "icons/svg/statue.svg",
  class: "icons/svg/combat.svg",
};

/** Stable 16-char Foundry id, so a re-run keeps every document's id. */
function makeId(source) {
  return crypto
    .createHash("sha256")
    .update(source)
    .digest("base64")
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(0, 16);
}

const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
const lower = (s) => (typeof s === "string" ? s.trim().toLowerCase() : "");
const statKey = (s) => {
  const k = lower(s).slice(0, 3);
  return STATS.includes(k) ? k : "";
};
const damageType = (s) => (DAMAGE_TYPES.includes(lower(s)) ? lower(s) : "");
const int = (v, fallback) =>
  Number.isFinite(Number(v)) && v !== null && v !== "" ? Math.trunc(Number(v)) : fallback;

/** "1d4 + Int" -> { dice: "1d4", stat: "int" }. Anything else stays text only. */
function parseBaseDamage(raw) {
  const m = String(raw ?? "").match(/^\s*(\d*d\d+(?:\s*[+-]\s*\d+)?)\s*(?:\+\s*([a-z]+))?\s*$/i);
  return m ? { dice: m[1].replace(/\s+/g, ""), stat: statKey(m[2]) } : { dice: "", stat: "" };
}

function upgrades(entry, raw) {
  return Object.entries(raw ?? {})
    .filter(([rank, text]) => int(rank) && text)
    .map(([rank, text]) => ({
      id: makeId(`pm-${entry.id}-upgrade-${rank}`),
      rankThreshold: int(rank),
      description: `<p>${esc(text)}</p>`,
    }))
    .sort((a, b) => a.rankThreshold - b.rankThreshold);
}

function list(label, items, fmt = esc) {
  if (!items?.length) return "";
  return `<p><strong>${label}</strong></p><ul>${items.map((i) => `<li>${fmt(i)}</li>`).join("")}</ul>`;
}

function facts(rows) {
  const filled = rows.filter(([, v]) => v !== undefined && v !== null && v !== "");
  if (!filled.length) return "";
  return `<table><tbody>${filled.map(([k, v]) => `<tr><th>${k}</th><td>${esc(v)}</td></tr>`).join("")}</tbody></table>`;
}

/** Credit line the API terms require wherever an entry is shown. */
function credit(entry) {
  const who = entry.source?.trim() || "the Point Mongo community";
  return `<hr><p><em>Source: ${esc(who)}. From <a href="${esc(entry.url)}">Point Mongo</a>.</em></p>`;
}

function warnings(entry) {
  const out = [];
  if (entry.needsRestat)
    out.push(
      "<p><strong>Needs restat:</strong> numbers predate the published rules and may be misleading.</p>",
    );
  if (entry.missingFields?.length)
    out.push(`<p><strong>Missing:</strong> ${esc(entry.missingFields.join(", "))}</p>`);
  return out.join("");
}

function description(entry, extra = "") {
  const summary = entry.summary ? `<p><em>${esc(entry.summary)}</em></p>` : "";
  return warnings(entry) + summary + (entry.body ?? "") + extra + credit(entry);
}

function flags(entry) {
  return {
    [MODULE_ID]: {
      id: entry.id,
      category: entry.category,
      slug: entry.slug,
      url: entry.url,
      source: entry.source ?? "",
      tags: entry.tags ?? [],
      updatedAt: entry.updatedAt,
      needsRestat: !!entry.needsRestat,
      missingFields: entry.missingFields ?? [],
    },
  };
}

function creature(entry, folder) {
  const c = entry.creature ?? {};
  const tier = BOSS_HB_BASE[lower(c.bossTier)] ? lower(c.bossTier) : "";
  const level = Math.max(1, int(c.level, 1));
  const floor = int(c.floor, 0);
  const hbSlots =
    int(c.healthBarSlots, null) ?? (tier ? BOSS_HB_BASE[tier] + floor : Math.min(level, 10));
  const stats = Object.fromEntries(STATS.map((k) => [k, { value: Math.max(1, int(c[k], 1)) }]));

  // carl-rpg derives Evade/Surprise and has no override field, so an author
  // value that breaks the formula is kept as text instead.
  const extra = facts([
    ["Floor", c.floor],
    ["Elite", c.elite ? "Yes (acts once per crawler)" : null],
    ["Evade (author)", c.evade],
    ["Surprise (author)", c.surprise],
  ]);

  return {
    name: entry.name,
    type: "mob",
    img: entry.image || DEFAULT_IMG.creature,
    folder,
    system: {
      biography: description(entry, extra),
      mobTier: tier,
      level,
      size: SIZES[c.size] ? `${SIZES[c.size]} (${c.size})` : "",
      creatureType: c.creatureType ?? "",
      move: c.move !== null && c.move !== undefined ? String(c.move) : "",
      hbSlotsOverride: int(c.healthBarSlots, null),
      hb: { value: hbSlots, max: hbSlots },
      dr: Math.max(0, int(c.dr, floor)),
      stats,
      attacks: (entry.attacks ?? []).map((a) => {
        const type = damageType(a.damageType);
        const unknownType = a.damageType && !type ? `${a.damageType} damage. ` : "";
        return {
          name: a.name ?? "",
          toHit: a.toHit ?? "",
          damage: a.damage ?? "",
          damageType: type,
          range: a.range ?? "",
          effect: (unknownType + (a.notes ?? "")).trim(),
        };
      }),
    },
    prototypeToken: { name: entry.name, actorLink: false },
    flags: flags(entry),
  };
}

function spell(entry, folder) {
  const s = entry.stats ?? {};
  const passive = lower(s.type) === "passive";
  const dmg = parseBaseDamage(s.baseDamage);
  const extra = facts([
    ["Base damage", s.baseDamage],
    ["AI favor", s.aiFavor],
    ["Limitations", s.limitations],
  ]);
  return {
    name: entry.name,
    type: "spell",
    img: entry.image || DEFAULT_IMG.spell,
    folder,
    system: {
      description: description(entry, extra),
      governingStat: statKey(s.stat),
      manaCost: Math.max(0, int(s.manaCost, 1)),
      range: s.range ?? "",
      duration: s.duration ?? "",
      cooldown: s.cooldown ?? "",
      isPassive: passive,
      castingKeywords: passive ? ["passive"] : lower(s.type) === "attack" ? ["attack"] : [],
      favoredClasses: (s.favored ?? []).filter((c) => typeof c === "string" && c.trim()),
      baseDamage: { ...dmg, damageType: damageType(s.damageType) },
      upgrades: upgrades(entry, s.upgrades),
    },
    flags: flags(entry),
  };
}

function skill(entry, folder) {
  const s = entry.stats ?? {};
  const cat = lower(s.skillCategory);
  const category = cat.includes("attack")
    ? "attack"
    : cat.startsWith("passive")
      ? "passive"
      : "utility";
  const attackType = cat.includes("melee") ? "melee" : cat.includes("ranged") ? "ranged" : "";
  const dmg = parseBaseDamage(s.baseDamage);
  const extra = facts([
    ["Category", s.skillCategory],
    ["Base damage", s.baseDamage],
  ]);
  return {
    name: entry.name,
    type: "skill",
    img: entry.image || DEFAULT_IMG.skill,
    folder,
    system: {
      description: description(entry, extra),
      governingStat: statKey(s.stat),
      category,
      attackType,
      isPassive: category === "passive",
      range: s.range ?? "",
      cooldown: s.cooldown ?? "",
      limitations: s.limitations ?? "",
      aiFavor: Math.max(0, int(s.aiFavor, 0)),
      baseDamage: { ...dmg, damageType: damageType(s.damageType) },
      upgrades: upgrades(entry, s.upgrades),
    },
    flags: flags(entry),
  };
}

function gear(entry, folder) {
  const s = entry.stats ?? {};
  const extra =
    facts([
      ["Slot", s.slot],
      ["Type", s.itemType],
      ["Tier", s.tier],
      ["Weapon skill", s.weaponSkill],
      ["Damage type", s.damageType],
      ["DR", s.dr],
      ["Duration", s.duration],
      ["Cooldown", s.cooldown],
      ["Charges", s.charges],
      ["Limitations", s.limitations],
    ]) + list("Effects", s.effects);
  return {
    name: entry.name,
    type: "item",
    img: entry.image || DEFAULT_IMG.gear,
    folder,
    system: { description: description(entry, extra) },
    flags: flags(entry),
  };
}

function buildOptions(s) {
  return (
    facts([
      ["Size", s.size],
      ["DR", s.dr],
      ["Prerequisites", s.prerequisites],
      ["Crafting table", s.craftingTable],
      ["Rank 20", s.rank20],
      ["Bonus box", s.bonusBox],
      ["Build points", s.buildPoints],
    ]) +
    list("Stat bonuses", s.statBonuses) +
    list("Skill bonuses", s.skillBonuses) +
    list(
      "Benefits",
      s.benefits,
      (b) => `${esc(b.text)}${b.tier ? ` <em>(${esc(b.tier)})</em>` : ""}`,
    ) +
    list(
      "Detriments",
      s.detriments,
      (d) => `${esc(d.text)}${d.points ? ` <em>(${esc(d.points)} pt)</em>` : ""}`,
    )
  );
}

function race(entry, folder) {
  const s = entry.stats ?? {};
  return {
    name: entry.name,
    type: "race",
    img: entry.image || DEFAULT_IMG.race,
    folder,
    system: {
      description: description(entry, buildOptions(s)),
      size: s.size ?? "",
      prerequisites: s.prerequisites ?? "",
      isEarthBased: s.earthBased === true,
      isAlien: s.earthBased === false,
    },
    flags: flags(entry),
  };
}

function cls(entry, folder) {
  const s = entry.stats ?? {};
  return {
    name: entry.name,
    type: "class",
    img: entry.image || DEFAULT_IMG.class,
    folder,
    system: {
      description: description(entry, buildOptions(s)),
      classTypes: (s.classTypes ?? []).filter((c) => typeof c === "string" && c.trim()),
      prerequisites: s.prerequisites ?? "",
      isEarthBased: s.earthBased === true,
    },
    flags: flags(entry),
  };
}

function journal(entry, folder, id) {
  const pageId = makeId(`pm-${entry.id}-page`);
  const extra =
    entry.stats && Object.keys(entry.stats).length
      ? facts(
          Object.entries(entry.stats).map(([k, v]) => [
            k,
            typeof v === "object" ? JSON.stringify(v) : v,
          ]),
        )
      : "";
  return {
    name: entry.name,
    folder,
    pages: [
      {
        _id: pageId,
        _key: `!journal.pages!${id}.${pageId}`,
        name: entry.name,
        type: "text",
        ...(entry.image ? { src: entry.image } : {}),
        text: {
          format: 1,
          content:
            (entry.image ? `<p><img src="${esc(entry.image)}"></p>` : "") +
            description(entry, extra),
        },
      },
    ],
    flags: flags(entry),
  };
}

const BUILDERS = { creature, spell, skill, gear, race, class: cls };

function packFor(entry) {
  if (BUILDERS[entry.kind]) {
    for (const [name, pack] of Object.entries(PACKS))
      if (pack.categories?.includes(entry.category)) return name;
  }
  return "codex";
}

function write(dir, file, doc) {
  fs.writeFileSync(path.join(dir, file), YAML.dump(doc, { lineWidth: -1, noRefs: true }));
}

const entries = JSON.parse(fs.readFileSync(path.join(RAW, "entries.json"), "utf8"));
const categories = JSON.parse(fs.readFileSync(path.join(RAW, "categories.json"), "utf8"));
const catName = Object.fromEntries(categories.map((c) => [c.slug, c.name]));

fs.rmSync(OUT, { recursive: true, force: true });
const counts = {};
const folders = {};
for (const entry of entries) {
  const packName = packFor(entry);
  const pack = PACKS[packName];
  const dir = path.join(OUT, packName);
  fs.mkdirSync(dir, { recursive: true });

  const folderKey = `${packName}/${entry.category}`;
  if (!folders[folderKey]) {
    const _id = makeId(`pm-folder-${folderKey}`);
    folders[folderKey] = _id;
    write(dir, `_folder_${entry.category}.yml`, {
      _id,
      _key: `!folders!${_id}`,
      name: catName[entry.category] ?? entry.category,
      type: pack.type,
      sorting: "a",
      folder: null,
    });
  }

  const _id = makeId(`pm-entry-${entry.id}`);
  const builder = packName === "codex" ? journal : BUILDERS[entry.kind];
  const doc = {
    _id,
    _key: `!${COLLECTION[pack.type]}!${_id}`,
    ...builder(entry, folders[folderKey], _id),
  };
  write(dir, `${entry.category}_${entry.slug}.yml`, doc);
  counts[packName] = (counts[packName] ?? 0) + 1;
}

console.log("Converted:", counts);
