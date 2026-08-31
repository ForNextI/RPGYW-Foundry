import {
  FOUNDRY_API_PATHS,
} from "./api-client.js";
import {
  applySessionRosterSnapshot,
} from "./session-roster.js";

let currentRoster = null;
let currentRosterLoadedAt = 0;

function isPlainObject(value) {
  return Boolean(
    value
      && typeof value === "object"
      && !Array.isArray(value),
  );
}

function requireString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${label} must be a non-empty string.`);
  }

  return value.trim();
}

function nullableString(value, label) {
  if (value === null) {
    return null;
  }

  return requireString(value, label);
}

function normalizeParticipant(value, index) {
  if (!isPlainObject(value)) {
    throw new TypeError(`participants[${index}] must be an object.`);
  }

  return Object.freeze({
    participantId: requireString(
      value.participantId,
      `participants[${index}].participantId`,
    ),
    displayName: requireString(
      value.displayName,
      `participants[${index}].displayName`,
    ),
    foundryUserId: nullableString(
      value.foundryUserId,
      `participants[${index}].foundryUserId`,
    ),
    attendance: (
      ["unknown", "present", "absent"].includes(value.attendance)
        ? value.attendance
        : "unknown"
    ),
  });
}

function normalizeControllerIds(value, label) {
  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be an array.`);
  }

  const ids = value.map((entry, index) => (
    requireString(entry, `${label}[${index}]`)
  ));

  return Object.freeze([...new Set(ids)]);
}

function normalizeCharacter(value, index) {
  if (!isPlainObject(value)) {
    throw new TypeError(`characters[${index}] must be an object.`);
  }

  return Object.freeze({
    campaignCharacterId: requireString(
      value.campaignCharacterId,
      `characters[${index}].campaignCharacterId`,
    ),
    displayName: requireString(
      value.displayName,
      `characters[${index}].displayName`,
    ),
    foundryActorId: nullableString(
      value.foundryActorId,
      `characters[${index}].foundryActorId`,
    ),
    controllerParticipantIds: normalizeControllerIds(
      value.controllerParticipantIds,
      `characters[${index}].controllerParticipantIds`,
    ),
  });
}

function normalizeRoster(value) {
  if (!isPlainObject(value) || value.version !== 1) {
    throw new TypeError("RPG Your Way returned an invalid Foundry roster.");
  }

  if (
    !Number.isSafeInteger(value.revision)
      || value.revision < 0
      || !Array.isArray(value.participants)
      || !Array.isArray(value.characters)
  ) {
    throw new TypeError("RPG Your Way returned an incomplete Foundry roster.");
  }

  return Object.freeze({
    version: 1,
    sessionId: requireString(value.sessionId, "sessionId"),
    revision: value.revision,
    participants: Object.freeze(
      value.participants.map(normalizeParticipant),
    ),
    characters: Object.freeze(
      value.characters.map(normalizeCharacter),
    ),
  });
}

function applyRosterToSessionControl(roster) {
  return applySessionRosterSnapshot({
    version: 1,
    sessionId: roster.sessionId,
    revision: roster.revision,
    participants: roster.participants.map((participant) => ({
      participantId: participant.participantId,
      foundryUserId: participant.foundryUserId,
      attendance: participant.attendance,
    })),
    actors: roster.characters
      .filter((character) => character.foundryActorId)
      .map((character) => ({
        actorId: character.foundryActorId,
        campaignCharacterId: character.campaignCharacterId,
        active: Boolean(game.actors.get(character.foundryActorId)),
        controllerParticipantIds: character.controllerParticipantIds,
      })),
  });
}

export async function refreshFoundryRoster(service) {
  const roster = normalizeRoster(
    await service.requestAuthenticated(
      FOUNDRY_API_PATHS.sessionRoster,
      { method: "GET" },
    ),
  );

  currentRoster = roster;
  currentRosterLoadedAt = Date.now();
  applyRosterToSessionControl(roster);
  return roster;
}

export async function ensureFoundryRoster(
  service,
  { maxAgeMs = 5_000 } = {},
) {
  if (
    currentRoster
      && Date.now() - currentRosterLoadedAt <= maxAgeMs
  ) {
    return currentRoster;
  }

  return refreshFoundryRoster(service);
}

export function getFoundryRoster() {
  return currentRoster;
}

export function getCampaignCharacterForActor(actorId) {
  if (!currentRoster || !actorId) {
    return null;
  }

  return currentRoster.characters.find(
    (character) => character.foundryActorId === actorId,
  ) ?? null;
}

function resolveCharacter(roster, selector) {
  const clean = requireString(selector, "character selector");

  if (/^\d+$/.test(clean)) {
    const index = Number(clean) - 1;
    if (index >= 0 && index < roster.characters.length) {
      return roster.characters[index];
    }
  }

  const matches = roster.characters.filter(
    (character) => (
      character.campaignCharacterId === clean
        || character.displayName.toLowerCase() === clean.toLowerCase()
    ),
  );

  if (matches.length === 1) {
    return matches[0];
  }

  throw new Error(
    "Choose a character by the number shown by /rpgyw roster.",
  );
}

function selectedActor() {
  const controlled = Array.from(canvas?.tokens?.controlled ?? []);

  if (controlled.length !== 1) {
    throw new Error("Select exactly one Foundry token before mapping a character.");
  }

  const token = controlled[0];
  const actorId = token.document?.actorId ?? token.actor?.id ?? null;

  if (!actorId) {
    throw new Error("The selected token does not have a Foundry Actor.");
  }

  return Object.freeze({
    actorId: String(actorId),
    actorName: String(
      token.actor?.name
        || token.document?.name
        || game.actors.get(actorId)?.name
        || actorId,
    ),
  });
}

export async function mapSelectedActorToCharacter(service, selector) {
  const roster = await refreshFoundryRoster(service);
  const character = resolveCharacter(roster, selector);
  const actor = selectedActor();

  await service.requestAuthenticated(
    FOUNDRY_API_PATHS.sessionRoster,
    {
      method: "POST",
      body: {
        version: 1,
        campaignCharacterId: character.campaignCharacterId,
        foundryActorId: actor.actorId,
      },
    },
  );

  const updatedRoster = await refreshFoundryRoster(service);

  return Object.freeze({
    actorName: actor.actorName,
    character: updatedRoster.characters.find(
      (candidate) => (
        candidate.campaignCharacterId === character.campaignCharacterId
      ),
    ),
    roster: updatedRoster,
  });
}

export async function unmapCharacter(service, selector) {
  const roster = await refreshFoundryRoster(service);
  const character = resolveCharacter(roster, selector);

  await service.requestAuthenticated(
    FOUNDRY_API_PATHS.sessionRoster,
    {
      method: "POST",
      body: {
        version: 1,
        campaignCharacterId: character.campaignCharacterId,
        foundryActorId: null,
      },
    },
  );

  return refreshFoundryRoster(service);
}
