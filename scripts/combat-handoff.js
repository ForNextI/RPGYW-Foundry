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

const POLL_INTERVAL_MS = 2_500;
const NAV_BUTTON_ID = "rpgyw-go-to-web";
const FALLBACK_ACTOR_IMAGE = "icons/svg/mystery-man.svg";
const MANAGED_SCENE_FLAG = "managedCombatScene";
const CHARACTER_FLAG = "campaignCharacterId";
const ENEMY_FLAG = "managedEnemy";
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

function currentFoundryLaunchUrl() {
  try {
    const url = new URL(window.location.href);
    url.hash = "";
    return url.toString();
  } catch {
    return window.location.href;
  }
}

function openRpgYourWay() {
  const target = window.open(
    `${RPGYW_API_ORIGIN}/play`,
    "rpgyw-play",
  );

  try {
    target?.focus();
  } catch {
    // Browser focus is best-effort.
  }
}

function ensureReturnButton() {
  window.name = "rpgyw-foundry-vtt";

  const existing = document.getElementById(NAV_BUTTON_ID);
  if (existing) {
    return existing;
  }

  const button = document.createElement("button");
  button.id = NAV_BUTTON_ID;
  button.type = "button";
  button.textContent = "Go to RPG Your Way";
  button.title = "Switch to RPG Your Way. This does not change game state.";
  button.setAttribute("aria-label", button.title);
  button.style.position = "fixed";
  button.style.right = "12px";
  button.style.bottom = "12px";
  button.style.zIndex = "100000";
  button.style.padding = "9px 12px";
  button.style.border = "1px solid rgba(255,255,255,0.35)";
  button.style.borderRadius = "8px";
  button.style.background = "rgba(20,24,20,0.92)";
  button.style.color = "white";
  button.style.fontWeight = "700";
  button.style.cursor = "pointer";
  button.style.boxShadow = "0 3px 14px rgba(0,0,0,0.35)";
  button.addEventListener("click", openRpgYourWay);
  document.body.append(button);
  return button;
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
      safeImageSource(actor.prototypeToken?.texture?.src)
        || safeImageSource(actor.img)
    ),
    actorImg: (
      safeImageSource(actor.img)
        || safeImageSource(actor.prototypeToken?.texture?.src)
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

async function ensurePlayerActor(character, encounterCharacter, roster) {
  let actor = findPlayerProxy(character.campaignCharacterId);
  const donor = oldMappedDonor(character, actor);
  const donorVisual = actorVisual(donor);
  const tokenSrc = (
    donorVisual.tokenSrc
      || monogramDataUri(characterMonogram(encounterCharacter.displayName))
  );
  const actorImg = donorVisual.actorImg || FALLBACK_ACTOR_IMAGE;
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

async function createEnemyActors(encounterId, enemies) {
  const nameCounts = new Map();

  for (const enemy of enemies) {
    const key = normalizeName(enemy.displayName);
    nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
  }

  const nameOrdinals = new Map();
  const actors = [];

  for (const enemy of enemies) {
    const key = normalizeName(enemy.displayName);
    const ordinal = nameOrdinals.get(key) ?? 0;
    nameOrdinals.set(key, ordinal + 1);

    const donor = findEnemyImageDonor(enemy.displayName);
    const visual = actorVisual(donor);
    const monogram = enemyMonogram(
      enemy.displayName,
      ordinal,
      nameCounts.get(key) ?? 1,
    );
    const tokenSrc = visual.tokenSrc || monogramDataUri(monogram);
    const actorImg = visual.actorImg || FALLBACK_ACTOR_IMAGE;

    let actor;

    try {
      actor = await Actor.create({
        name: enemy.displayName,
        type: "npc",
        img: actorImg,
        flags: {
          [MODULE_ID]: {
            [ENEMY_FLAG]: true,
            [SOURCE_ENCOUNTER_FLAG]: encounterId,
            combatantId: enemy.combatantId,
          },
        },
        prototypeToken: enemyPrototypeToken(
          enemy.displayName,
          tokenSrc,
        ),
      });
    } catch (error) {
      if (!String(tokenSrc).startsWith("data:")) {
        throw error;
      }

      actor = await Actor.create({
        name: enemy.displayName,
        type: "npc",
        img: actorImg,
        flags: {
          [MODULE_ID]: {
            [ENEMY_FLAG]: true,
            [SOURCE_ENCOUNTER_FLAG]: encounterId,
            combatantId: enemy.combatantId,
          },
        },
        prototypeToken: enemyPrototypeToken(
          enemy.displayName,
          FALLBACK_ACTOR_IMAGE,
        ),
      });
    }

    if (!actor) {
      throw new Error(
        `Foundry could not create the RPG Your Way enemy Actor ${enemy.displayName}.`,
      );
    }

    actors.push({
      actor,
      enemy,
    });
  }

  return actors;
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

  const donor = findLocalSceneDonor(sceneSpec, scene?.id ?? null);
  const width = donor
    ? safeSceneNumber(donor.width, 2400, 800, 12000)
    : 2400;
  const height = donor
    ? safeSceneNumber(donor.height, 1600, 800, 12000)
    : 1600;
  const gridSize = donor
    ? safeSceneNumber(donor.grid?.size, 100, 40, 300)
    : 100;
  const label = cleanString(
    sceneSpec.label,
    "Combat",
  ).slice(0, 80);
  const sceneData = {
    name: `RPGYW Combat — ${label}`,
    width,
    height,
    padding: 0.05,
    navigation: true,
    background: {
      src: donor ? safeImageSource(donor.background?.src) : null,
    },
    grid: {
      type: squareGridType(),
      size: gridSize,
      distance: cleanNumber(donor?.grid?.distance, 5) ?? 5,
      units: cleanString(donor?.grid?.units, "ft"),
    },
    flags: {
      [MODULE_ID]: {
        [MANAGED_SCENE_FLAG]: true,
        [SOURCE_ENCOUNTER_FLAG]: encounter.id,
        localBackgroundSourceSceneId: donor?.id ?? null,
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

  return scene;
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
    width: 1,
    height: 1,
    disposition: friendly
      ? dispositionFriendly()
      : dispositionHostile(),
    displayName: tokenDisplayAlways(),
    displayBars: tokenDisplayHover(),
    bar1: {
      attribute: hpBar ? "attributes.hp" : null,
    },
    bar2: {
      attribute: null,
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
      || raw.payload.version !== 1
      || !Array.isArray(raw.payload.party)
      || !Array.isArray(raw.payload.enemies)
  ) {
    throw new TypeError("RPG Your Way returned an incomplete VTT encounter.");
  }

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

async function buildPlayerActors(service, encounter, roster) {
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

async function createSceneTokens(
  scene,
  playerActors,
  enemyActors,
) {
  const gridSize = cleanNumber(scene.grid?.size, 100) ?? 100;
  const width = cleanNumber(scene.width, 2400) ?? 2400;
  const height = cleanNumber(scene.height, 1600) ?? 1600;
  const tokenData = [];

  playerActors.forEach((entry, index) => {
    const position = formationPosition(
      index,
      playerActors.length,
      "left",
      width,
      height,
      gridSize,
    );

    tokenData.push(sceneTokenData(
      entry.actor,
      {
        ...position,
        friendly: true,
        hpBar: true,
      },
    ));
  });

  enemyActors.forEach((entry, index) => {
    const position = formationPosition(
      index,
      enemyActors.length,
      "right",
      width,
      height,
      gridSize,
    );

    tokenData.push(sceneTokenData(
      entry.actor,
      {
        ...position,
        friendly: false,
        hpBar: false,
      },
    ));
  });

  if (tokenData.length === 0) {
    throw new Error(
      "The RPG Your Way encounter did not contain any combatants Foundry could place.",
    );
  }

  await scene.createEmbeddedDocuments(
    "Token",
    tokenData,
  );
}

async function renderEncounter(service, rawEncounter) {
  const encounter = normalizeEncounter(rawEncounter);
  const roster = await loadRosterForEncounter(
    service,
    encounter.payload,
  );
  const scene = await ensureManagedScene(encounter);

  await deleteManagedEnemyActors();

  const playerActors = await buildPlayerActors(
    service,
    encounter,
    roster,
  );
  const enemyActors = await createEnemyActors(
    encounter.id,
    encounter.payload.enemies,
  );

  await createSceneTokens(
    scene,
    playerActors,
    enemyActors,
  );

  await scene.activate({
    pullUsers: true,
  });

  return {
    encounterId: encounter.id,
    foundrySceneId: scene.id,
    playerCount: playerActors.length,
    enemyCount: enemyActors.length,
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
        `RPG Your Way combat ready: ${rendered.playerCount} player token${rendered.playerCount === 1 ? "" : "s"} and ${rendered.enemyCount} enemy token${rendered.enemyCount === 1 ? "" : "s"}.`,
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

  handoffRuntime = runtime;
  return publicApi;
}
