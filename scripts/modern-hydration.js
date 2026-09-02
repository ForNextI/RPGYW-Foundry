import {
  MODULE_ID,
} from "./settings.js";

const HYDRATION_FLAG = "managedHydration";
const HYDRATION_VERSION = 1;
const MODERN_RULESET_ID = "dnd-5.5e-srd-5.2.1";
const MODERN_PACKS = Object.freeze({
  classes: ["dnd5e.classes24"],
  origins: ["dnd5e.origins24"],
  feats: ["dnd5e.classes24", "dnd5e.origins24", "dnd5e.feats24"],
  spells: ["dnd5e.spells24"],
  equipment: ["dnd5e.equipment24"],
});

const ABILITIES = Object.freeze({
  strength: "str",
  dexterity: "dex",
  constitution: "con",
  intelligence: "int",
  wisdom: "wis",
  charisma: "cha",
});

const SKILLS = Object.freeze({
  acrobatics: "acr",
  "animal handling": "ani",
  arcana: "arc",
  athletics: "ath",
  deception: "dec",
  history: "his",
  insight: "ins",
  intimidation: "itm",
  investigation: "inv",
  medicine: "med",
  nature: "nat",
  perception: "prc",
  performance: "prf",
  persuasion: "per",
  religion: "rel",
  "sleight of hand": "slt",
  stealth: "ste",
  survival: "sur",
});

const indexCache = new Map();

function cleanString(value, fallback = "") {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : fallback;
}

function normalizeName(value) {
  return cleanString(value)
    .normalize("NFKD")
    .toLocaleLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function integerFromText(value, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }

  const match = String(value ?? "").match(/-?\d+/);
  return match ? Math.trunc(Number(match[0])) : fallback;
}

function positiveIntegerFromText(value, fallback = 0) {
  return Math.max(0, integerFromText(value, fallback));
}

function abilityKey(value) {
  const normalized = normalizeName(value);
  if (!normalized) return "";

  for (const [name, key] of Object.entries(ABILITIES)) {
    if (normalized === name || normalized === key || normalized.startsWith(`${name} `)) {
      return key;
    }
  }

  return "";
}

function savingThrowSet(values) {
  const result = new Set();
  for (const value of values ?? []) {
    const normalized = normalizeName(value);
    for (const [name, key] of Object.entries(ABILITIES)) {
      if (
        normalized === name
          || normalized === key
          || normalized.startsWith(`${name} `)
          || normalized.startsWith(`${key} `)
      ) {
        result.add(key);
      }
    }
  }
  return result;
}

function skillProficiencies(values) {
  const result = new Map();

  for (const value of values ?? []) {
    const normalized = normalizeName(value);
    for (const [name, key] of Object.entries(SKILLS)) {
      if (normalized === name || normalized.startsWith(`${name} `)) {
        const proficiency = /expertise|double proficiency|\bx2\b/i.test(String(value))
          ? 2
          : /half proficiency/i.test(String(value))
            ? 0.5
            : 1;
        result.set(key, Math.max(result.get(key) ?? 0, proficiency));
      }
    }
  }

  return result;
}

function walkSpeed(value) {
  const number = positiveIntegerFromText(value, 30);
  return number > 0 ? number : 30;
}

function initiativeBonus(mechanics) {
  const dexterity = finiteNumber(mechanics?.abilityScores?.dexterity, 10);
  const dexterityModifier = Math.floor((dexterity - 10) / 2);
  return integerFromText(mechanics?.initiativeModifier, dexterityModifier) - dexterityModifier;
}

function quantityValue(value) {
  const quantity = positiveIntegerFromText(value, 1);
  return quantity > 0 ? quantity : 1;
}

function safeFlags(data, source) {
  return {
    ...(data?.flags ?? {}),
    [MODULE_ID]: {
      ...(data?.flags?.[MODULE_ID] ?? {}),
      [HYDRATION_FLAG]: true,
      hydrationVersion: HYDRATION_VERSION,
      sourcePack: source.pack,
      sourceDocumentId: source.id,
      sourceKind: source.kind,
    },
  };
}

function stripEmbeddedOnlyFields(data) {
  const clean = { ...data };
  delete clean._id;
  delete clean._stats;
  delete clean.folder;
  delete clean.sort;
  delete clean.ownership;
  return clean;
}

async function packIndex(packId) {
  if (indexCache.has(packId)) return indexCache.get(packId);

  const pack = game.packs?.get(packId);
  if (!pack) {
    indexCache.set(packId, null);
    return null;
  }

  const index = await pack.getIndex({ fields: ["name", "type"] });
  const value = { pack, entries: Array.from(index ?? []) };
  indexCache.set(packId, value);
  return value;
}

async function exactModernItem(name, packIds, allowedTypes = null) {
  const target = normalizeName(name);
  if (!target) return null;

  for (const packId of packIds) {
    const indexed = await packIndex(packId);
    if (!indexed) continue;

    const entry = indexed.entries.find((candidate) => {
      if (normalizeName(candidate.name) !== target) return false;
      if (!allowedTypes) return true;
      return allowedTypes.includes(candidate.type);
    });

    if (!entry?._id) continue;
    const document = await indexed.pack.getDocument(entry._id);
    if (!document) continue;

    return {
      pack: packId,
      id: entry._id,
      document,
    };
  }

  return null;
}

function prepareCompendiumItem(match, kind, options = {}) {
  let data = stripEmbeddedOnlyFields(match.document.toObject());
  data.flags = safeFlags(data, {
    pack: match.pack,
    id: match.id,
    kind,
  });

  if (kind === "class" && data.system && Object.hasOwn(data.system, "levels")) {
    data.system.levels = Math.max(1, Math.min(20, integerFromText(options.level, 1)));
  }

  if (options.quantity && data.system && Object.hasOwn(data.system, "quantity")) {
    data.system.quantity = quantityValue(options.quantity);
  }

  if (options.equipped && data.system && Object.hasOwn(data.system, "equipped")) {
    data.system.equipped = true;
  }

  if (kind === "spell" && data.system?.preparation && Object.hasOwn(data.system.preparation, "prepared")) {
    data.system.preparation.prepared = options.prepared !== false;
  }

  return data;
}

async function managedItems(actor) {
  return actor.items?.filter(
    (item) => item.getFlag(MODULE_ID, HYDRATION_FLAG) === true,
  ) ?? [];
}

async function clearManagedItems(actor) {
  const ids = (await managedItems(actor)).map((item) => item.id).filter(Boolean);
  if (ids.length > 0) {
    await actor.deleteEmbeddedDocuments("Item", ids);
  }
}

function resourceUpdates(resources) {
  const slots = ["primary", "secondary", "tertiary"];
  const updates = {};

  slots.forEach((slot, index) => {
    const resource = resources?.[index];
    if (!resource) {
      updates[`system.resources.${slot}.label`] = "";
      updates[`system.resources.${slot}.value`] = 0;
      updates[`system.resources.${slot}.max`] = 0;
      return;
    }

    updates[`system.resources.${slot}.label`] = cleanString(resource.name).slice(0, 80);
    updates[`system.resources.${slot}.value`] = positiveIntegerFromText(resource.current, 0);
    updates[`system.resources.${slot}.max`] = positiveIntegerFromText(resource.maximum, 0);
  });

  return updates;
}

function spellSlotUpdates(slots) {
  const updates = {};

  for (const entry of slots ?? []) {
    const level = positiveIntegerFromText(entry.level, 0);
    if (level < 1 || level > 9) continue;

    const total = positiveIntegerFromText(entry.total, 0);
    const used = positiveIntegerFromText(entry.used, 0);
    updates[`system.spells.spell${level}.override`] = total;
    updates[`system.spells.spell${level}.value`] = Math.max(0, total - used);
  }

  return updates;
}

function actorSystemUpdates(encounterCharacter) {
  const mechanics = encounterCharacter.mechanics ?? {};
  const saves = savingThrowSet(mechanics.savingThrows);
  const skills = skillProficiencies(mechanics.skills);
  const updates = {
    "system.attributes.hp.value": Math.max(0, integerFromText(encounterCharacter.currentHitPoints, 0)),
    "system.attributes.hp.max": Math.max(1, integerFromText(encounterCharacter.maximumHitPoints, 1)),
    "system.attributes.hp.temp": Math.max(0, integerFromText(encounterCharacter.temporaryHitPoints, 0)),
    "system.attributes.ac.calc": "flat",
    "system.attributes.ac.flat": Math.max(0, integerFromText(encounterCharacter.armorClass, 10)),
    "system.attributes.movement.walk": walkSpeed(mechanics.speed),
    "system.attributes.init.bonus": String(initiativeBonus(mechanics)),
    "system.attributes.death.success": Math.max(0, Math.min(3, integerFromText(mechanics.deathSaves?.successes, 0))),
    "system.attributes.death.failure": Math.max(0, Math.min(3, integerFromText(mechanics.deathSaves?.failures, 0))),
    "system.currency.cp": positiveIntegerFromText(mechanics.currency?.cp, 0),
    "system.currency.sp": positiveIntegerFromText(mechanics.currency?.sp, 0),
    "system.currency.ep": positiveIntegerFromText(mechanics.currency?.ep, 0),
    "system.currency.gp": positiveIntegerFromText(mechanics.currency?.gp, 0),
    "system.currency.pp": positiveIntegerFromText(mechanics.currency?.pp, 0),
    ...resourceUpdates(mechanics.resources),
    ...spellSlotUpdates(mechanics.spellcasting?.slots),
  };

  const spellcastingAbility = abilityKey(mechanics.spellcasting?.ability);
  if (spellcastingAbility) {
    updates["system.attributes.spellcasting"] = spellcastingAbility;
  }

  for (const [name, key] of Object.entries(ABILITIES)) {
    updates[`system.abilities.${key}.value`] = Math.max(
      1,
      Math.min(30, integerFromText(mechanics.abilityScores?.[name], 10)),
    );
    updates[`system.abilities.${key}.proficient`] = saves.has(key) ? 1 : 0;
  }

  for (const key of Object.values(SKILLS)) {
    updates[`system.skills.${key}.value`] = skills.get(key) ?? 0;
  }

  return updates;
}

async function buildModernItems(mechanics) {
  const items = [];
  const unmatched = {
    classes: [],
    subclasses: [],
    species: [],
    backgrounds: [],
    attacks: [],
    equipment: [],
    spells: [],
    features: [],
  };
  const seen = new Map();

  const addMatch = (match, kind, name, options = {}) => {
    if (!match) return false;
    const key = `${match.pack}:${match.id}`;
    const existing = seen.get(key);
    if (existing) {
      if (options.quantity && existing.system && Object.hasOwn(existing.system, "quantity")) existing.system.quantity = Math.max(finiteNumber(existing.system.quantity, 1), quantityValue(options.quantity));
      if (options.equipped && existing.system && Object.hasOwn(existing.system, "equipped")) existing.system.equipped = true;
      const moduleFlags = existing.flags?.[MODULE_ID] ?? {};
      const sourceKinds = new Set([...(moduleFlags.sourceKinds ?? []), moduleFlags.sourceKind, kind].filter(Boolean));
      existing.flags[MODULE_ID] = { ...moduleFlags, sourceKinds: [...sourceKinds] };
      return true;
    }
    const prepared = prepareCompendiumItem(match, kind, options);
    prepared.flags[MODULE_ID] = { ...(prepared.flags?.[MODULE_ID] ?? {}), sourceKinds: [kind] };
    seen.set(key, prepared); items.push(prepared); return true;
  };

  for (const entry of mechanics.classes ?? []) {
    const classMatch = await exactModernItem(entry.name, MODERN_PACKS.classes, ["class"]);
    if (!addMatch(classMatch, "class", entry.name, { level: entry.level })) {
      unmatched.classes.push(entry.name);
    }

    if (cleanString(entry.subclass)) {
      const subclassMatch = await exactModernItem(entry.subclass, MODERN_PACKS.classes, ["subclass"]);
      if (!addMatch(subclassMatch, "subclass", entry.subclass)) {
        unmatched.subclasses.push(entry.subclass);
      }
    }
  }

  if (cleanString(mechanics.species)) {
    const speciesMatch = await exactModernItem(mechanics.species, MODERN_PACKS.origins, ["race"]);
    if (!addMatch(speciesMatch, "species", mechanics.species)) {
      unmatched.species.push(mechanics.species);
    }
  }

  if (cleanString(mechanics.background)) {
    const backgroundMatch = await exactModernItem(mechanics.background, MODERN_PACKS.origins, ["background"]);
    if (!addMatch(backgroundMatch, "background", mechanics.background)) {
      unmatched.backgrounds.push(mechanics.background);
    }
  }

  for (const attack of mechanics.attacks ?? []) {
    const match = await exactModernItem(
      attack.name,
      MODERN_PACKS.equipment,
      ["weapon", "equipment", "consumable", "tool"],
    );
    if (!addMatch(match, "attack", attack.name, { equipped: true })) {
      unmatched.attacks.push(attack.name);
    }
  }

  for (const entry of [...(mechanics.armorAndShields ?? []), ...(mechanics.equipment ?? [])]) {
    const match = await exactModernItem(
      entry.name,
      MODERN_PACKS.equipment,
      ["weapon", "equipment", "consumable", "tool", "loot"],
    );
    const equipped = !/unequipped|not equipped|carried|pack|stowed/i.test(cleanString(entry.sheetStatus));
    if (!addMatch(match, "equipment", entry.name, { quantity: entry.quantity, equipped })) {
      unmatched.equipment.push(entry.name);
    }
  }

  const preparedSpellNames = new Set([
    ...(mechanics.spellcasting?.cantrips ?? []),
    ...(mechanics.spellcasting?.preparedOrKnownSpells ?? []),
  ].map(normalizeName));
  const spellNames = [
    ...(mechanics.spellcasting?.cantrips ?? []),
    ...(mechanics.spellcasting?.preparedOrKnownSpells ?? []),
    ...(mechanics.spellcasting?.spellbookOrOtherSpells ?? []),
  ];

  for (const name of spellNames) {
    const match = await exactModernItem(name, MODERN_PACKS.spells, ["spell"]);
    if (!addMatch(match, "spell", name, { prepared: preparedSpellNames.has(normalizeName(name)) })) {
      unmatched.spells.push(name);
    }
  }

  for (const feature of mechanics.features ?? []) {
    const match = await exactModernItem(feature.name, MODERN_PACKS.feats, ["feat"]);
    if (!addMatch(match, "feature", feature.name)) {
      unmatched.features.push(feature.name);
    }
  }

  return {
    items,
    unmatched: Object.fromEntries(
      Object.entries(unmatched).map(([key, values]) => [
        key,
        Array.from(new Set(values.map(cleanString).filter(Boolean))).slice(0, 80),
      ]),
    ),
  };
}

function requireModernDnd5e(encounterCharacter) {
  if (encounterCharacter.rulesetId !== MODERN_RULESET_ID || encounterCharacter.foundryRulesVersion !== "2024") {
    throw new Error("RPG Your Way sent a character that is not marked for D&D 5.5e / 2024 Modern Foundry hydration.");
  }

  if (game.system?.id !== "dnd5e") {
    throw new Error("RPG Your Way 2.12 full-character hydration currently requires the Foundry D&D5e system.");
  }

  const rulesVersion = game.settings.get("dnd5e", "rulesVersion");
  if (rulesVersion !== "modern") {
    throw new Error("Set the Foundry D&D5e Rules Version to Modern before using RPG Your Way D&D 5.5e full-character hydration.");
  }

  if (!encounterCharacter.mechanics || encounterCharacter.mechanics.schema !== 1) {
    throw new Error("RPG Your Way did not provide the 2.12 Modern character mechanics payload.");
  }
}

export async function hydrateModernCharacter(actor, encounterCharacter) {
  requireModernDnd5e(encounterCharacter);

  await actor.update({
    ...actorSystemUpdates(encounterCharacter),
    [`flags.${MODULE_ID}.hydrationRuleset`]: MODERN_RULESET_ID,
    [`flags.${MODULE_ID}.hydrationRulesVersion`]: "2024",
    [`flags.${MODULE_ID}.hydrationVersion`]: HYDRATION_VERSION,
  });

  await clearManagedItems(actor);
  const built = await buildModernItems(encounterCharacter.mechanics);

  if (built.items.length > 0) {
    await actor.createEmbeddedDocuments("Item", built.items);
  }

  await actor.update({
    [`flags.${MODULE_ID}.hydrationUnmatched`]: built.unmatched,
    [`flags.${MODULE_ID}.hydratedAt`]: new Date().toISOString(),
  });

  const unmatchedCount = Object.values(built.unmatched)
    .reduce((total, values) => total + values.length, 0);

  console.log(
    `${MODULE_ID} | hydrated ${actor.name}: ${built.items.length} Modern items, ${unmatchedCount} unmatched record entries`,
    built.unmatched,
  );

  return Object.freeze({
    itemCount: built.items.length,
    unmatched: built.unmatched,
  });
}
