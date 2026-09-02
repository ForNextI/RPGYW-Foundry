import {
  FOUNDRY_API_PATHS,
  RPGYW_API_ORIGIN,
} from "./api-client.js";
import {
  getControllerStatus,
} from "./controller.js";
import {
  refreshFoundryRoster,
} from "./mapping-service.js";
import {
  MODULE_ID,
} from "./settings.js";
import {
  createManagedCombat,
} from "./combat-tracker.js";
import {
  focusOrOpenRpgYourWay,
  installFoundryFocusBridge,
} from "./focus-navigation.js";
import {
  resolveCompendiumTokenImage,
  resolveLocalMapImage,
  resolveLocalTokenImage,
} from "./local-assets.js";
import {
  hydrateModernCharacter,
} from "./modern-hydration.js";
import { createActorFromSrdTemplate } from "./srd-actors.js";
import { combatBackgroundForSetup, redrawSetupWalls } from "./combat-backgrounds.js";

const POLL_INTERVAL_MS = 2_500;
const NAV_BUTTON_ID = "rpgyw-go-to-web";
const FALLBACK_ACTOR_IMAGE = "icons/svg/mystery-man.svg";
const MANAGED_SCENE_FLAG = "managedCombatScene";
const CHARACTER_FLAG = "campaignCharacterId";
const ENEMY_FLAG = "managedEnemy";
const BYSTANDER_FLAG = "managedBystander";
const SOURCE_ENCOUNTER_FLAG = "sourceEncounterId";

let handoffRuntime = null;

function tokenDisplayAlways() {
  return CONST?.TOKEN_DISPLAY_MODES?.ALWAYS ?? 50;
}

function tokenDisplayHover() {
  return CONST?.TOKEN_DISPLAY_MODES?.HOVER ?? 30;
}

function dispositionFriendly() {
  return CONST?.TOKEN_DISPOSITIONS?.FRIENDLY ?? 1;
}

function dispositionHostile() {
  return CONST?.TOKEN_DISPOSITIONS?.HOSTILE ?? -1;
}

function dispositionNeutral() {
  return CONST?.TOKEN_DISPOSITIONS?.NEUTRAL ?? 0;
}

function ownershipNone() {
  return CONST?.DOCUMENT_OWNERSHIP_LEVELS?.NONE ?? 0;
}

function ownershipOwner() {
  return CONST?.DOCUMENT_OWNERSHIP_LEVELS?.OWNER ?? 3;
}

function squareGridType() {
  return CONST?.GRID_TYPES?.SQUARE ?? 1;
}

function plainObject(value) {
  return Boolean(
    value
      && typeof value === "object"
      && !Array.isArray(value),
  );
}

function cleanString(value, fallback = "") {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : fallback;
}

function cleanNumber(value, fallback = null) {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function normalizeName(value) {
  return cleanString(value)
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function safeImageSource(value) {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : null;
}

function realVisualSource(value) {
  const src = safeImageSource(value);
  if (!src) return null;
  if (src === FALLBACK_ACTOR_IMAGE) return null;
  if (src.startsWith("data:image/svg+xml")) return null;
  return src;
}

function preferredReadyToPlayAsset(value) {
  const src = safeImageSource(value);
  const prefix = `modules/${MODULE_ID}/assets/ready-to-play/`;
  return src?.startsWith(prefix) ? src : null;
}

function currentFoundryLaunchUrl() {
  try {
    const url = new URL(window.location.href);
    url.hash = "";
    return url.toString();
  } catch {
    return window.location.href;
  }
}

function ensureReturnButton() {
  installFoundryFocusBridge();

  const existing = document.getElementById(NAV_BUTTON_ID);
  if (existing) {
    return existing;
  }

  const dock = document.createElement("div");
  dock.id = NAV_BUTTON_ID;
  dock.style.position = "fixed";
  dock.style.right = "8px";
  dock.style.bottom = "0";
  dock.style.zIndex = "100000";
  dock.style.display = "grid";
  dock.style.justifyItems = "end";
  dock.style.transform = "translateY(calc(100% - 26px))";
  dock.style.transition = "transform 140ms ease";

  const tab = document.createElement("button");
  tab.type = "button";
  tab.textContent = "▲ RPGYW";
  tab.title = "Show or hide the RPG Your Way navigation control.";
  tab.style.minHeight = "26px";
  tab.style.padding = "2px 8px";
  tab.style.border = "1px solid rgba(255,255,255,0.35)";
  tab.style.borderBottom = "0";
  tab.style.borderRadius = "8px 8px 0 0";
  tab.style.background = "rgba(20,24,20,0.94)";
  tab.style.color = "white";
  tab.style.fontWeight = "700";
  tab.style.cursor = "pointer";

  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "Go to RPG Your Way";
  button.title = "Switch to RPG Your Way. This does not change game state.";
  button.setAttribute("aria-label", button.title);
  button.style.padding = "9px 12px";
  button.style.border = "1px solid rgba(255,255,255,0.35)";
  button.style.borderRadius = "8px 0 0 0";
  button.style.background = "rgba(20,24,20,0.94)";
  button.style.color = "white";
  button.style.fontWeight = "700";
  button.style.cursor = "pointer";
  button.style.boxShadow = "0 3px 14px rgba(0,0,0,0.35)";
  button.addEventListener(
    "click",
    () => void focusOrOpenRpgYourWay(),
  );

  let open = false;
  tab.addEventListener("click", () => {
    open = !open;
    tab.textContent = open ? "▼ RPGYW" : "▲ RPGYW";
    dock.style.transform = open
      ? "translateY(0)"
      : "translateY(calc(100% - 26px))";
  });

  dock.append(tab, button);
  document.body.append(dock);
  return dock;
}

function characterMonogram(name) {
  const normalized = cleanString(name, "PC")
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9 ]+/g, " ")
    .trim();

  const firstWord = normalized.split(/\s+/)[0] || "PC";
  return firstWord.slice(0, 3).toUpperCase().padEnd(1, "P");
}

function enemyMonogram(name, ordinal, duplicateCount) {
  const base = characterMonogram(name);

  if (duplicateCount <= 1) {
    return base;
  }

  return `${base.slice(0, 2)}${ordinal + 1}`.slice(0, 3);
}

function monogramDataUri(label) {
  const safeLabel = cleanString(label, "PC")
    .replace(/[^A-Za-z0-9]/g, "")
    .slice(0, 3)
    .toUpperCase() || "PC";

  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">',
    '<circle cx="128" cy="128" r="120" fill="#242824" stroke="#f0ead6" stroke-width="10"/>',
    `<text x="128" y="151" text-anchor="middle" font-family="Arial,sans-serif" font-size="${safeLabel.length === 3 ? 78 : 92}" font-weight="700" fill="#ffffff">${safeLabel}</text>`,
    "</svg>",
  ].join("");

  return `data:image/svg+xml;base64,${btoa(svg)}`;
}

function actorVisual(actor) {
  if (!actor) {
    return Object.freeze({
      tokenSrc: null,
      actorImg: null,
    });
  }

  return Object.freeze({
    tokenSrc: (
      realVisualSource(actor.prototypeToken?.texture?.src)
        || realVisualSource(actor.img)
    ),
    actorImg: (
      realVisualSource(actor.img)
        || realVisualSource(actor.prototypeToken?.texture?.src)
    ),
  });
}

function rosterParticipantMap(roster) {
  return new Map(
    (roster?.participants ?? []).map(
      (participant) => [participant.participantId, participant],
    ),
  );
}

function ownershipForCharacter(character, roster) {
  const participantById = rosterParticipantMap(roster);
  const ownership = {
    default: ownershipNone(),
  };

  for (const participantId of character.controllerParticipantIds ?? []) {
    const foundryUserId = participantById.get(participantId)?.foundryUserId;
    if (foundryUserId) {
      ownership[foundryUserId] = ownershipOwner();
    }
  }

  return ownership;
}

function playerPrototypeToken(name, textureSrc) {
  return {
    name,
    actorLink: true,
    width: 1,
    height: 1,
    disposition: dispositionFriendly(),
    displayName: tokenDisplayAlways(),
    displayBars: tokenDisplayHover(),
    bar1: {
      attribute: "attributes.hp",
    },
    bar2: {
      attribute: null,
    },
    texture: {
      src: textureSrc,
    },
  };
}

function enemyPrototypeToken(name, textureSrc) {
  return {
    name,
    actorLink: true,
    width: 1,
    height: 1,
    disposition: dispositionHostile(),
    displayName: tokenDisplayAlways(),
    displayBars: tokenDisplayHover(),
    bar1: {
      attribute: null,
    },
    bar2: {
      attribute: null,
    },
    texture: {
      src: textureSrc,
    },
  };
}

function findPlayerProxy(campaignCharacterId) {
  return game.actors?.contents?.find(
    (actor) => (
      actor.getFlag(MODULE_ID, CHARACTER_FLAG) === campaignCharacterId
    ),
  ) ?? null;
}

function oldMappedDonor(character, proxyActor) {
  if (proxyActor) {
    const visual = actorVisual(proxyActor);
    if (visual.tokenSrc || visual.actorImg) {
      return proxyActor;
    }
  }

  const actorId = character.foundryActorId;
  return actorId ? game.actors.get(actorId) : null;
}

async function ensurePlayerActor(
  character,
  encounterCharacter,
  roster,
  sceneSummary,
) {
  let actor = findPlayerProxy(character.campaignCharacterId);
  const donor = oldMappedDonor(character, actor);
  const donorVisual = actorVisual(donor);
  const preferredTokenSrc = preferredReadyToPlayAsset(
    encounterCharacter.preferredTokenAsset,
  );
  const localTokenSrc = preferredTokenSrc || donorVisual.tokenSrc
    ? null
    : await resolveLocalTokenImage({
      name: encounterCharacter.displayName,
      visualTags: encounterCharacter.visualTags ?? [],
      sceneSummary,
    });
  const compendiumTokenSrc = preferredTokenSrc || donorVisual.tokenSrc || localTokenSrc
    ? null
    : await resolveCompendiumTokenImage({
      name: encounterCharacter.displayName,
      visualTags: encounterCharacter.visualTags ?? [],
      sceneSummary,
    });
  const tokenSrc = (
    preferredTokenSrc
      || donorVisual.tokenSrc
      || localTokenSrc
      || compendiumTokenSrc
      || monogramDataUri(characterMonogram(encounterCharacter.displayName))
  );
  const actorImg = donorVisual.actorImg || preferredTokenSrc || FALLBACK_ACTOR_IMAGE;
  const ownership = ownershipForCharacter(character, roster);
  const prototypeToken = playerPrototypeToken(
    encounterCharacter.displayName,
    tokenSrc,
  );

  if (!actor) {
    actor = await Actor.create({
      name: encounterCharacter.displayName,
      type: "character",
      img: actorImg,
      ownership,
      flags: {
        [MODULE_ID]: {
          [CHARACTER_FLAG]: character.campaignCharacterId,
          managedCharacter: true,
        },
      },
      prototypeToken,
    });
  }

  if (!actor) {
    throw new Error(
      `Foundry could not create the RPG Your Way Actor for ${encounterCharacter.displayName}.`,
    );
  }

  const hpValue = Math.max(
    0,
    Math.trunc(cleanNumber(encounterCharacter.currentHitPoints, 0)),
  );
  const hpMax = Math.max(
    1,
    Math.trunc(cleanNumber(encounterCharacter.maximumHitPoints, hpValue || 1)),
  );
  const hpTemp = Math.max(
    0,
    Math.trunc(cleanNumber(encounterCharacter.temporaryHitPoints, 0)),
  );

  try {
    await actor.update({
      name: encounterCharacter.displayName,
      img: actorImg,
      ownership,
      flags: {
        [MODULE_ID]: {
          [CHARACTER_FLAG]: character.campaignCharacterId,
          managedCharacter: true,
        },
      },
      prototypeToken,
      system: {
        attributes: {
          hp: {
            value: Math.min(hpValue, hpMax),
            max: hpMax,
            temp: hpTemp,
          },
        },
      },
    });
  } catch (error) {
    if (!String(tokenSrc).startsWith("data:")) {
      throw error;
    }

    const fallbackToken = playerPrototypeToken(
      encounterCharacter.displayName,
      FALLBACK_ACTOR_IMAGE,
    );

    await actor.update({
      name: encounterCharacter.displayName,
      img: actorImg,
      ownership,
      prototypeToken: fallbackToken,
      system: {
        attributes: {
          hp: {
            value: Math.min(hpValue, hpMax),
            max: hpMax,
            temp: hpTemp,
          },
        },
      },
    });
  }

  await hydrateModernCharacter(actor, encounterCharacter);

  return actor;
}

function findEnemyImageDonor(name) {
  const target = normalizeName(name);
  if (!target) {
    return null;
  }

  return game.actors?.contents?.find((actor) => {
    if (actor.getFlag(MODULE_ID, ENEMY_FLAG)) {
      return false;
    }

    if (actor.getFlag(MODULE_ID, "managedCharacter")) {
      return false;
    }

    return normalizeName(actor.name) === target;
  }) ?? null;
}

async function deleteManagedEnemyActors() {
  const actors = game.actors?.contents?.filter(
    (actor) => actor.getFlag(MODULE_ID, ENEMY_FLAG) === true,
  ) ?? [];

  for (const actor of actors) {
    await actor.delete();
  }
}

async function fallbackNpcActor({ encounterId, entry, sceneSummary, sceneSetup, bystander = false }) {
  const plannedActor = findPlannedActor(sceneSetup, entry.displayName);
  const visualTags = entry.visualTags ?? plannedActor?.visual_tags ?? [];
  const donor = findEnemyImageDonor(entry.displayName); const visual = actorVisual(donor);
  const localTokenSrc = visual.tokenSrc ? null : await resolveLocalTokenImage({ name: entry.displayName, visualTags, sceneSummary });
  const compendiumTokenSrc = visual.tokenSrc || localTokenSrc ? null : await resolveCompendiumTokenImage({ name: entry.displayName, visualTags, sceneSummary });
  const tokenSrc = visual.tokenSrc || localTokenSrc || compendiumTokenSrc || monogramDataUri(characterMonogram(entry.displayName));
  const neutral = bystander === true; const friendly = entry.side === "ally";
  const flags = { [MODULE_ID]: { [ENEMY_FLAG]: !neutral, [BYSTANDER_FLAG]: neutral, [SOURCE_ENCOUNTER_FLAG]: encounterId, combatantId: entry.combatantId, srdTemplate: cleanString(entry.srdTemplate, "") } };
  const native = await createActorFromSrdTemplate({ templateName: cleanString(entry.srdTemplate, entry.displayName), displayName: entry.displayName, flags, disposition: neutral ? dispositionNeutral() : friendly ? dispositionFriendly() : dispositionHostile(), displayNameMode: tokenDisplayAlways(), displayBarsMode: tokenDisplayHover() });
  if (native) return native;
  const prototypeToken = { ...enemyPrototypeToken(entry.displayName, tokenSrc), disposition: neutral ? dispositionNeutral() : friendly ? dispositionFriendly() : dispositionHostile(), bar1: { attribute: "attributes.hp" } };
  const actorData = { name: entry.displayName, type: "npc", img: visual.actorImg || FALLBACK_ACTOR_IMAGE, flags, prototypeToken };
  if (neutral) actorData.system = { attributes: { hp: { value: 10, max: 10, temp: 0 }, ac: { calc: "flat", flat: 10 } } };
  try { return await Actor.create(actorData); } catch (error) { if (!String(tokenSrc).startsWith("data:")) throw error; actorData.prototypeToken.texture.src = FALLBACK_ACTOR_IMAGE; return Actor.create(actorData); }
}
async function createEnemyActors(encounterId,enemies,sceneSummary,sceneSetup) { const actors=[]; for (const enemy of enemies) { const actor=await fallbackNpcActor({encounterId,entry:enemy,sceneSummary,sceneSetup,bystander:false}); if(!actor) throw new Error(`Foundry could not create the RPG Your Way enemy Actor ${enemy.displayName}.`); actors.push({actor,enemy}); } return actors; }
async function createBystanderActors(encounterId,bystanders,sceneSummary,sceneSetup) { const actors=[]; for (const bystander of bystanders ?? []) { const actor=await fallbackNpcActor({encounterId,entry:bystander,sceneSummary,sceneSetup,bystander:true}); if(!actor) throw new Error(`Foundry could not create the RPG Your Way bystander Actor ${bystander.displayName}.`); actors.push({actor,bystander}); } return actors; }

function normalizeSetupPlan(value) {
  if (!plainObject(value) || value.enabled !== true) {
    return null;
  }

  const snap = (raw, fallback, maximum) => {
    const number = cleanNumber(raw, fallback) ?? fallback;
    return Math.max(
      0,
      Math.min(maximum, Math.round(number / 5) * 5),
    );
  };

  const widthFt = 200;
  const heightFt = 200;
  const start = plainObject(value.player_start_area)
    ? value.player_start_area
    : {};

  return {
    enabled: true,
    environment: cleanString(value.environment, "combat area"),
    width_ft: widthFt,
    height_ft: heightFt,
    player_start_area: {
      x_ft: snap(start.x_ft, 5, widthFt),
      y_ft: snap(start.y_ft, 5, heightFt),
      width_ft: Math.max(5, snap(start.width_ft, 15, widthFt)),
      height_ft: Math.max(
        5,
        snap(start.height_ft, Math.max(10, heightFt - 10), heightFt),
      ),
    },
    features: Array.isArray(value.features)
      ? value.features.slice(0, 16).filter(plainObject)
      : [],
    actors: Array.isArray(value.actors)
      ? value.actors.slice(0, 40).filter(plainObject)
      : [],
    asset_search_terms: Array.isArray(value.asset_search_terms)
      ? value.asset_search_terms
          .filter((entry) => typeof entry === "string")
          .slice(0, 16)
      : [],
  };
}

function findPlannedActor(setup, name) {
  const target = normalizeName(name);
  if (!setup || !target) return null;

  return setup.actors.find(
    (actor) => normalizeName(actor.name) === target,
  ) ?? null;
}

function feetToPixels(value, gridSize) {
  return Math.round((Number(value) || 0) / 5 * gridSize);
}

function setupPosition(actorPlan, gridSize, width, height) {
  if (!actorPlan) return null;

  return {
    x: clamp(
      feetToPixels(actorPlan.x_ft, gridSize),
      0,
      Math.max(0, width - gridSize),
    ),
    y: clamp(
      feetToPixels(actorPlan.y_ft, gridSize),
      0,
      Math.max(0, height - gridSize),
    ),
  };
}

function playerSetupPosition(
  index,
  count,
  setup,
  gridSize,
  width,
  height,
) {
  if (!setup) {
    return formationPosition(
      index,
      count,
      "left",
      width,
      height,
      gridSize,
    );
  }

  const area = setup.player_start_area;
  const x0 = feetToPixels(area.x_ft, gridSize);
  const y0 = feetToPixels(area.y_ft, gridSize);
  const areaWidth = Math.max(
    gridSize,
    feetToPixels(area.width_ft, gridSize),
  );
  const areaHeight = Math.max(
    gridSize,
    feetToPixels(area.height_ft, gridSize),
  );
  const columns = Math.max(1, Math.floor(areaWidth / gridSize));
  const rows = Math.max(1, Math.floor(areaHeight / gridSize));
  const column = index % columns;
  const row = Math.floor(index / columns) % rows;

  return {
    x: clamp(
      x0 + column * gridSize,
      0,
      Math.max(0, width - gridSize),
    ),
    y: clamp(
      y0 + row * gridSize,
      0,
      Math.max(0, height - gridSize),
    ),
  };
}

function drawingRectangleType() {
  return (
    foundry?.canvas?.placeables?.Drawing?.SHAPE_TYPES?.RECTANGLE
      ?? foundry?.data?.ShapeData?.TYPES?.RECTANGLE
      ?? null
  );
}

function setupDrawingData(setup, scene) {
  if (!setup) return [];

  const gridSize = cleanNumber(scene.grid?.size, 100) ?? 100;
  const rectangleType = drawingRectangleType();

  if (!rectangleType) {
    console.warn(
      `${MODULE_ID} | Foundry rectangle Drawing type unavailable; skipping architectural Drawings.`,
    );
    return [];
  }
  const outline = {
    label: setup.environment || "Combat area",
    kind: "room",
    x_ft: 0,
    y_ft: 0,
    width_ft: setup.width_ft,
    height_ft: setup.height_ft,
  };

  return [outline, ...setup.features].map((feature) => ({
    name: `RPGYW ${cleanString(
      feature.label,
      feature.kind || "feature",
    )}`.slice(0, 120),
    x: feetToPixels(feature.x_ft, gridSize),
    y: feetToPixels(feature.y_ft, gridSize),
    shape: {
      type: rectangleType,
      x: 0,
      y: 0,
      width: Math.max(
        gridSize,
        feetToPixels(feature.width_ft, gridSize),
      ),
      height: Math.max(
        gridSize,
        feetToPixels(feature.height_ft, gridSize),
      ),
      anchorX: 0,
      anchorY: 0,
    },
    fillType: CONST?.DRAWING_FILL_TYPES?.NONE ?? 0,
    fillAlpha: 0,
    strokeAlpha: 0.9,
    strokeWidth: feature.kind === "door" ? 6 : 3,
    strokeColor: 0x353535,
    text: cleanString(feature.label, "").slice(0, 60),
    textAlpha: feature.kind === "room" ? 0.45 : 0.7,
    fontSize: Math.max(14, Math.min(26, Math.round(gridSize / 4))),
    locked: true,
    flags: {
      [MODULE_ID]: {
        managedSetupDrawing: true,
      },
    },
  }));
}

async function redrawSetup(scene, setup) {
  const ids = Array.from(scene.drawings ?? [])
    .filter(
      (drawing) => drawing.getFlag(
        MODULE_ID,
        "managedSetupDrawing",
      ) === true,
    )
    .map((drawing) => drawing.id)
    .filter(Boolean);

  if (ids.length > 0) {
    await scene.deleteEmbeddedDocuments("Drawing", ids);
  }

  const drawings = setupDrawingData(setup, scene);
  if (drawings.length > 0) {
    await scene.createEmbeddedDocuments("Drawing", drawings);
  }
}

const SCENE_KEYWORDS = Object.freeze([
  "tavern",
  "inn",
  "forest",
  "woods",
  "cave",
  "cavern",
  "dungeon",
  "street",
  "alley",
  "castle",
  "keep",
  "temple",
  "shrine",
  "ship",
  "dock",
  "road",
  "village",
  "house",
  "room",
  "warehouse",
  "sewer",
  "ruin",
  "tower",
  "camp",
  "bridge",
]);

function requestedSceneKeywords(sceneSpec) {
  const source = normalizeName(
    `${sceneSpec?.label ?? ""} ${sceneSpec?.summary ?? ""}`,
  );

  return SCENE_KEYWORDS.filter(
    (keyword) => source.includes(keyword),
  );
}

function findLocalSceneDonor(sceneSpec, managedSceneId) {
  const requested = requestedSceneKeywords(sceneSpec);
  if (requested.length === 0) {
    return null;
  }

  let best = null;
  let bestScore = 0;

  for (const scene of game.scenes?.contents ?? []) {
    if (scene.id === managedSceneId) {
      continue;
    }

    const src = safeImageSource(scene.background?.src);
    if (!src) {
      continue;
    }

    const name = normalizeName(scene.name);
    const score = requested.reduce(
      (total, keyword) => (
        total + (name.includes(keyword) ? 1 : 0)
      ),
      0,
    );

    if (score > bestScore) {
      best = scene;
      bestScore = score;
    }
  }

  return best;
}

function safeSceneNumber(value, fallback, minimum, maximum) {
  const number = cleanNumber(value, fallback);
  return clamp(
    Math.round(number ?? fallback),
    minimum,
    maximum,
  );
}

async function ensureManagedScene(encounter) {
  const sceneSpec = plainObject(encounter.payload?.scene)
    ? encounter.payload.scene
    : {};

  let scene = game.scenes?.contents?.find(
    (candidate) => (
      candidate.getFlag(MODULE_ID, MANAGED_SCENE_FLAG) === true
    ),
  ) ?? null;

  const setup = normalizeSetupPlan(encounter.payload?.vttSetup);
  const coreBackground = setup ? combatBackgroundForSetup(setup, sceneSpec) : null;
  const donor = coreBackground ? null : findLocalSceneDonor(sceneSpec, scene?.id ?? null);
  const localMap = coreBackground || donor ? null : await resolveLocalMapImage(sceneSpec, setup?.asset_search_terms ?? []);
  const gridSize = setup ? 100 : donor ? safeSceneNumber(donor.grid?.size, 100, 40, 300) : 100;
  const width = setup ? 4000 : donor ? safeSceneNumber(donor.width, 2400, 800, 12000) : safeSceneNumber(localMap?.width, 2400, 800, 12000);
  const height = setup ? 4000 : donor ? safeSceneNumber(donor.height, 1600, 800, 12000) : safeSceneNumber(localMap?.height, 1600, 800, 12000);
  const label = cleanString(
    sceneSpec.label,
    "Combat",
  ).slice(0, 80);
  const sceneData = {
    name: `RPGYW Combat — ${label}`,
    width,
    height,
    padding: setup ? 0 : 0.05,
    navigation: true,
    tokenVision: false,
    environment: {
      darknessLevel: 0,
      darknessLevelLock: true,
      globalLight: {
        enabled: CONST?.LIGHTING_LEVELS?.BRIGHT ?? 2,
        bright: true,
      },
    },
    background: {
      src: coreBackground || (donor ? safeImageSource(donor.background?.src) : localMap?.src ?? null),
    },
    grid: {
      type: squareGridType(),
      size: gridSize,
      distance: setup ? 5 : (cleanNumber(donor?.grid?.distance, 5) ?? 5),
      units: setup ? "ft" : cleanString(donor?.grid?.units, "ft"),
    },
    flags: {
      [MODULE_ID]: {
        [MANAGED_SCENE_FLAG]: true,
        [SOURCE_ENCOUNTER_FLAG]: encounter.id,
        localBackgroundSourceSceneId: donor?.id ?? null,
        localBackgroundAsset: coreBackground || localMap?.src || null,
        setupEnvironment: setup?.environment ?? null,
        combatCanvasFeet: setup ? 200 : null,
      },
    },
  };

  if (!scene) {
    scene = await Scene.create(sceneData);
  } else {
    await scene.update(sceneData);
  }

  if (!scene) {
    throw new Error("Foundry could not create the RPG Your Way combat Scene.");
  }

  const tokenIds = Array.from(scene.tokens ?? [])
    .map((token) => token.id)
    .filter(Boolean);

  if (tokenIds.length > 0) {
    await scene.deleteEmbeddedDocuments("Token", tokenIds);
  }

  try {
    await redrawSetupWalls(scene, setup);
  } catch (error) {
    console.warn(
      `${MODULE_ID} | architectural Foundry walls could not be created; continuing encounter render`,
      error,
    );
  }

  try {
    await redrawSetup(scene, setup);
  } catch (error) {
    console.warn(
      `${MODULE_ID} | architectural Drawings could not be created; continuing encounter render`,
      error,
    );
  }

  return {
    scene,
    setup,
  };
}

function formationPosition(
  index,
  count,
  side,
  width,
  height,
  gridSize,
) {
  const rows = Math.min(6, Math.max(1, count));
  const column = Math.floor(index / rows);
  const row = index % rows;
  const rowSpacing = Math.max(gridSize * 1.5, (height - gridSize * 4) / rows);
  const y = clamp(
    gridSize * 1.5 + row * rowSpacing,
    gridSize,
    height - gridSize * 2,
  );

  const xBase = side === "left"
    ? gridSize * 2
    : width - gridSize * 3;
  const direction = side === "left" ? 1 : -1;
  const x = clamp(
    xBase + direction * column * gridSize * 2,
    gridSize,
    width - gridSize * 2,
  );

  return {
    x: Math.round(x / gridSize) * gridSize,
    y: Math.round(y / gridSize) * gridSize,
  };
}

function sceneTokenData(
  actor,
  {
    x,
    y,
    friendly,
    neutral = false,
    hpBar,
  },
) {
  const prototype = actor.prototypeToken;
  const textureSrc = (
    safeImageSource(prototype?.texture?.src)
      || safeImageSource(actor.img)
      || FALLBACK_ACTOR_IMAGE
  );

  return {
    name: actor.name,
    actorId: actor.id,
    actorLink: true,
    x,
    y,
    width: Math.max(0.5, cleanNumber(prototype?.width, 1) ?? 1),
    height: Math.max(0.5, cleanNumber(prototype?.height, 1) ?? 1),
    disposition: neutral ? dispositionNeutral() : friendly ? dispositionFriendly() : dispositionHostile(),
    displayName: tokenDisplayAlways(),
    displayBars: tokenDisplayHover(),
    bar1: {
      attribute: hpBar ? "attributes.hp" : null,
    },
    bar2: {
      attribute: null,
    },
    sight: {
      enabled: false,
      range: null,
    },
    texture: {
      src: textureSrc,
    },
  };
}

function normalizeEncounter(raw) {
  if (!plainObject(raw)) {
    throw new TypeError("RPG Your Way returned an invalid VTT encounter.");
  }

  if (
    typeof raw.id !== "string"
      || !plainObject(raw.payload)
      || (raw.payload.version !== 1 && raw.payload.version !== 2 && raw.payload.version !== 3)
      || !Array.isArray(raw.payload.party)
      || !Array.isArray(raw.payload.enemies)
  ) {
    throw new TypeError("RPG Your Way returned an incomplete VTT encounter.");
  }

  if (!Array.isArray(raw.payload.bystanders)) raw.payload.bystanders = [];
  return raw;
}

function fallbackRosterFromEncounter(payload) {
  return {
    mappingAvailable: false,
    participants: [],
    characters: payload.party.map((character) => ({
      campaignCharacterId: cleanString(character.campaignCharacterId),
      displayName: cleanString(character.displayName, "Character"),
      foundryActorId: null,
      controllerParticipantIds: [],
    })),
  };
}

async function loadRosterForEncounter(service, payload) {
  try {
    const roster = await refreshFoundryRoster(service);
    return {
      ...roster,
      mappingAvailable: true,
    };
  } catch (error) {
    if (
      error?.code === "multiplayer_campaign_required"
        || error?.code === "multiplayer_session_required"
    ) {
      return fallbackRosterFromEncounter(payload);
    }

    throw error;
  }
}

async function mapPlayerActor(
  service,
  roster,
  campaignCharacterId,
  foundryActorId,
) {
  if (!roster.mappingAvailable) {
    return;
  }

  await service.requestAuthenticated(
    FOUNDRY_API_PATHS.sessionRoster,
    {
      method: "POST",
      body: {
        version: 1,
        campaignCharacterId,
        foundryActorId,
      },
    },
  );
}

async function buildPlayerActors(
  service,
  encounter,
  roster,
  sceneSummary,
) {
  const partyById = new Map(
    encounter.payload.party.map(
      (character) => [character.campaignCharacterId, character],
    ),
  );
  const actors = [];

  for (const character of roster.characters) {
    const encounterCharacter = partyById.get(
      character.campaignCharacterId,
    );

    if (!encounterCharacter) {
      continue;
    }

    const actor = await ensurePlayerActor(
      character,
      encounterCharacter,
      roster,
      sceneSummary,
    );

    await mapPlayerActor(
      service,
      roster,
      character.campaignCharacterId,
      actor.id,
    );

    actors.push({
      actor,
      character: encounterCharacter,
    });
  }

  if (roster.mappingAvailable) {
    await refreshFoundryRoster(service);
  }

  return actors;
}

async function createSceneTokens(scene, playerActors, enemyActors, bystanderActors, setup) {
  const gridSize=cleanNumber(scene.grid?.size,100)??100, width=cleanNumber(scene.width,4000)??4000, height=cleanNumber(scene.height,4000)??4000; const entries=[];
  playerActors.forEach((entry,index)=>{const position=playerSetupPosition(index,playerActors.length,setup,gridSize,width,height); entries.push({actorId:entry.actor.id,data:sceneTokenData(entry.actor,{...position,friendly:true,hpBar:true}),initiative:cleanNumber(entry.character.initiative,null)});});
  enemyActors.forEach((entry,index)=>{const planned=findPlannedActor(setup,entry.enemy.displayName); const position=setupPosition(planned,gridSize,width,height)||formationPosition(index,enemyActors.length,"right",width,height,gridSize); entries.push({actorId:entry.actor.id,data:sceneTokenData(entry.actor,{...position,friendly:entry.enemy.side==="ally",hpBar:true}),initiative:cleanNumber(entry.enemy.initiative,null)});});
  bystanderActors.forEach((entry,index)=>{const planned=findPlannedActor(setup,entry.bystander.displayName); const position=setupPosition(planned,gridSize,width,height)||formationPosition(index,bystanderActors.length,"right",width,height,gridSize); entries.push({actorId:entry.actor.id,data:sceneTokenData(entry.actor,{...position,friendly:false,neutral:true,hpBar:true}),initiative:cleanNumber(entry.bystander.initiative,5)});});
  if(!entries.length) throw new Error("The RPG Your Way encounter did not contain any combatants Foundry could place.");
  const tokens=await scene.createEmbeddedDocuments("Token",entries.map(e=>e.data)); const byActorId=new Map(entries.map(e=>[e.actorId,e]));
  return tokens.map(token=>({token,initiative:byActorId.get(token.actorId||token.actor?.id||"")?.initiative??null}));
}

async function renderEncounter(service, rawEncounter) {
  const encounter = normalizeEncounter(rawEncounter);
  const sceneSummary = cleanString(
    encounter.payload?.scene?.summary,
    "",
  );
  const roster = await loadRosterForEncounter(
    service,
    encounter.payload,
  );
  const managed = await ensureManagedScene(encounter);
  const scene = managed.scene;
  const setup = managed.setup;

  await deleteManagedEnemyActors();

  const playerActors = await buildPlayerActors(
    service,
    encounter,
    roster,
    sceneSummary,
  );
  const enemyActors = await createEnemyActors(encounter.id, encounter.payload.enemies, sceneSummary, setup);
  const bystanderActors = await createBystanderActors(encounter.id, encounter.payload.bystanders, sceneSummary, setup);
  const placements = await createSceneTokens(scene, playerActors, enemyActors, bystanderActors, setup);

  await scene.activate({
    pullUsers: true,
  });

  const combat = await createManagedCombat({
    scene,
    encounterId: encounter.id,
    placements,
  });

  return {
    encounterId: encounter.id,
    foundrySceneId: scene.id,
    foundryCombatId: combat.id,
    playerCount: playerActors.length,
    enemyCount: enemyActors.length,
    bystanderCount: bystanderActors.length,
  };
}

async function reportEncounter(
  service,
  encounterId,
  body,
) {
  return service.requestAuthenticated(
    `/encounters/${encodeURIComponent(encounterId)}/result`,
    {
      method: "POST",
      body,
    },
  );
}

function controllerCanPoll(service) {
  if (!game.user?.isGM) {
    return false;
  }

  const controller = getControllerStatus();
  if (controller.state !== "local-controller") {
    return false;
  }

  return service.getStatus().hasSessionGrant === true;
}

async function pollOnce(runtime) {
  if (
    runtime.stopped
      || runtime.busy
      || !controllerCanPoll(runtime.service)
  ) {
    return null;
  }

  runtime.busy = true;

  try {
    const response = await runtime.service.requestAuthenticated(
      FOUNDRY_API_PATHS.encounterNext,
      {
        method: "POST",
        body: {
          launchUrl: currentFoundryLaunchUrl(),
        },
      },
    );

    runtime.lastErrorCode = null;

    if (!response?.encounter) {
      return null;
    }

    const encounter = normalizeEncounter(
      response.encounter,
    );

    try {
      const rendered = await renderEncounter(
        runtime.service,
        encounter,
      );

      await reportEncounter(
        runtime.service,
        encounter.id,
        {
          status: "rendered",
          foundrySceneId: rendered.foundrySceneId,
        },
      );

      ui.notifications.info(
        `RPG Your Way setup ready: ${rendered.playerCount} player token${rendered.playerCount === 1 ? "" : "s"}, ${rendered.enemyCount} active NPC token${rendered.enemyCount === 1 ? "" : "s"}, ${rendered.bystanderCount} bystander token${rendered.bystanderCount === 1 ? "" : "s"}, and initiative loaded. Position player characters, then use Begin Combat for round 1.`,
      );

      return rendered;
    } catch (error) {
      try {
        await reportEncounter(
          runtime.service,
          encounter.id,
          {
            status: "failed",
            errorMessage: (
              error?.message
                || "Foundry could not render the RPG Your Way encounter."
            ),
          },
        );
      } catch (reportError) {
        console.error(
          `${MODULE_ID} | could not report combat render failure`,
          reportError,
        );
      }

      throw error;
    }
  } catch (error) {
    const code = (
      error?.code
        || error?.body?.code
        || error?.message
        || "unknown"
    );

    if (runtime.lastErrorCode !== code) {
      console.warn(
        `${MODULE_ID} | combat handoff waiting`,
        error,
      );
      runtime.lastErrorCode = code;
    }

    return null;
  } finally {
    runtime.busy = false;
  }
}

export function initializeFoundryCombatHandoff(service) {
  if (handoffRuntime) {
    return handoffRuntime.publicApi;
  }

  ensureReturnButton();

  const runtime = {
    service,
    busy: false,
    stopped: false,
    timer: null,
    lastErrorCode: null,
    publicApi: null,
  };

  const publicApi = Object.freeze({
    pollNow: () => pollOnce(runtime),
    renderEncounter: (encounter) => renderEncounter(
      service,
      encounter,
    ),
    stop: () => {
      runtime.stopped = true;
      if (runtime.timer !== null) {
        window.clearInterval(runtime.timer);
        runtime.timer = null;
      }
    },
  });

  runtime.publicApi = publicApi;
  runtime.timer = window.setInterval(
    () => void pollOnce(runtime),
    POLL_INTERVAL_MS,
  );

  window.setTimeout(
    () => void pollOnce(runtime),
    500,
  );

  const pollOnWake = () => void pollOnce(runtime);
  window.addEventListener("focus", pollOnWake);
  window.addEventListener("online", pollOnWake);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      pollOnWake();
    }
  });

  handoffRuntime = runtime;
  return publicApi;
}
