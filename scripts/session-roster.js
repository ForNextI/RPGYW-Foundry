export const SESSION_ROSTER_PROTOCOL_VERSION = 1;

const ATTENDANCE_STATES = new Set(["present", "absent"]);

const SNAPSHOT_KEYS = new Set([
  "version",
  "sessionId",
  "revision",
  "participants",
  "actors",
]);

const PARTICIPANT_KEYS = new Set([
  "participantId",
  "foundryUserId",
  "attendance",
]);

const ACTOR_KEYS = new Set([
  "actorId",
  "campaignCharacterId",
  "active",
  "controllerParticipantIds",
]);

let currentSnapshot = null;

function isPlainObject(value) {
  return Boolean(
    value
      && typeof value === "object"
      && !Array.isArray(value),
  );
}

function assertPlainObject(value, label) {
  if (!isPlainObject(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
}

function assertExactKeys(value, allowedKeys, label) {
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      throw new TypeError(`${label} contains unsupported field "${key}".`);
    }
  }
}

function requireNonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${label} must be a non-empty string.`);
  }

  return value.trim();
}

function normalizeNullableId(value, label) {
  if (value === null) {
    return null;
  }

  return requireNonEmptyString(value, label);
}

function normalizeParticipant(participant, index) {
  const label = `participants[${index}]`;

  assertPlainObject(participant, label);
  assertExactKeys(participant, PARTICIPANT_KEYS, label);

  const participantId = requireNonEmptyString(
    participant.participantId,
    `${label}.participantId`,
  );

  const foundryUserId = normalizeNullableId(
    participant.foundryUserId,
    `${label}.foundryUserId`,
  );

  if (!ATTENDANCE_STATES.has(participant.attendance)) {
    throw new TypeError(
      `${label}.attendance must be "present" or "absent".`,
    );
  }

  return Object.freeze({
    participantId,
    foundryUserId,
    attendance: participant.attendance,
  });
}

function normalizeControllerParticipantIds(value, label) {
  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be an array.`);
  }

  const normalized = value.map((participantId, index) => (
    requireNonEmptyString(
      participantId,
      `${label}[${index}]`,
    )
  ));

  if (new Set(normalized).size !== normalized.length) {
    throw new TypeError(`${label} must not contain duplicate participant IDs.`);
  }

  return Object.freeze(normalized);
}

function normalizeActor(actor, index) {
  const label = `actors[${index}]`;

  assertPlainObject(actor, label);
  assertExactKeys(actor, ACTOR_KEYS, label);

  if (typeof actor.active !== "boolean") {
    throw new TypeError(`${label}.active must be a boolean.`);
  }

  return Object.freeze({
    actorId: requireNonEmptyString(
      actor.actorId,
      `${label}.actorId`,
    ),
    campaignCharacterId: normalizeNullableId(
      actor.campaignCharacterId,
      `${label}.campaignCharacterId`,
    ),
    active: actor.active,
    controllerParticipantIds: normalizeControllerParticipantIds(
      actor.controllerParticipantIds,
      `${label}.controllerParticipantIds`,
    ),
  });
}

function assertUniqueIds(items, key, label) {
  const ids = items.map((item) => item[key]);

  if (new Set(ids).size !== ids.length) {
    throw new TypeError(`${label} must contain unique ${key} values.`);
  }
}

function validateControllerReferences(participants, actors) {
  const participantIds = new Set(
    participants.map((participant) => participant.participantId),
  );

  for (const actor of actors) {
    for (const participantId of actor.controllerParticipantIds) {
      if (!participantIds.has(participantId)) {
        throw new TypeError(
          `Actor "${actor.actorId}" references unknown controller participant `
            + `"${participantId}".`,
        );
      }
    }
  }
}

function normalizeSnapshot(snapshot) {
  assertPlainObject(snapshot, "session roster");
  assertExactKeys(snapshot, SNAPSHOT_KEYS, "session roster");

  if (snapshot.version !== SESSION_ROSTER_PROTOCOL_VERSION) {
    throw new TypeError(
      `session roster version must be ${SESSION_ROSTER_PROTOCOL_VERSION}.`,
    );
  }

  if (!Number.isSafeInteger(snapshot.revision) || snapshot.revision < 0) {
    throw new TypeError(
      "session roster revision must be a non-negative safe integer.",
    );
  }

  if (!Array.isArray(snapshot.participants)) {
    throw new TypeError("session roster participants must be an array.");
  }

  if (!Array.isArray(snapshot.actors)) {
    throw new TypeError("session roster actors must be an array.");
  }

  const participants = Object.freeze(
    snapshot.participants.map(normalizeParticipant),
  );

  const actors = Object.freeze(
    snapshot.actors.map(normalizeActor),
  );

  assertUniqueIds(participants, "participantId", "session roster participants");
  assertUniqueIds(actors, "actorId", "session roster actors");
  validateControllerReferences(participants, actors);

  return Object.freeze({
    version: SESSION_ROSTER_PROTOCOL_VERSION,
    sessionId: requireNonEmptyString(
      snapshot.sessionId,
      "session roster sessionId",
    ),
    revision: snapshot.revision,
    participants,
    actors,
  });
}

function snapshotsMatch(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function applySessionRosterSnapshot(snapshot) {
  const normalized = normalizeSnapshot(snapshot);

  if (
    currentSnapshot
      && currentSnapshot.sessionId === normalized.sessionId
  ) {
    if (normalized.revision < currentSnapshot.revision) {
      throw new Error(
        `Stale session roster revision ${normalized.revision}; `
          + `current revision is ${currentSnapshot.revision}.`,
      );
    }

    if (normalized.revision === currentSnapshot.revision) {
      if (!snapshotsMatch(currentSnapshot, normalized)) {
        throw new Error(
          "Conflicting session roster snapshots use the same revision.",
        );
      }

      return currentSnapshot;
    }
  }

  currentSnapshot = normalized;
  return currentSnapshot;
}

export function clearSessionRoster({ sessionId = null } = {}) {
  if (
    sessionId !== null
      && currentSnapshot
      && currentSnapshot.sessionId !== sessionId
  ) {
    return false;
  }

  currentSnapshot = null;
  return true;
}

export function getSessionRosterSnapshot() {
  return currentSnapshot;
}

export function getParticipantsForFoundryUser(foundryUserId) {
  const normalizedUserId = requireNonEmptyString(
    foundryUserId,
    "foundryUserId",
  );

  if (!currentSnapshot) {
    return Object.freeze([]);
  }

  return Object.freeze(
    currentSnapshot.participants.filter(
      (participant) => participant.foundryUserId === normalizedUserId,
    ),
  );
}

export function getControlledActorIds(
  participantId,
  { activeOnly = true } = {},
) {
  const normalizedParticipantId = requireNonEmptyString(
    participantId,
    "participantId",
  );

  if (!currentSnapshot) {
    return Object.freeze([]);
  }

  return Object.freeze(
    currentSnapshot.actors
      .filter((actor) => (
        (!activeOnly || actor.active)
          && actor.controllerParticipantIds.includes(normalizedParticipantId)
      ))
      .map((actor) => actor.actorId),
  );
}

export function getControllerParticipantIdsForActor(actorId) {
  const normalizedActorId = requireNonEmptyString(actorId, "actorId");

  if (!currentSnapshot) {
    return Object.freeze([]);
  }

  const actor = currentSnapshot.actors.find(
    (candidate) => candidate.actorId === normalizedActorId,
  );

  return actor?.controllerParticipantIds ?? Object.freeze([]);
}

export function getCurrentUserControlledActorIds(
  { activeOnly = true } = {},
) {
  const foundryUserId = game.user?.id;

  if (!foundryUserId || !currentSnapshot) {
    return Object.freeze([]);
  }

  const participantIds = new Set(
    getParticipantsForFoundryUser(foundryUserId)
      .map((participant) => participant.participantId),
  );

  return Object.freeze(
    currentSnapshot.actors
      .filter((actor) => (
        (!activeOnly || actor.active)
          && actor.controllerParticipantIds.some(
            (participantId) => participantIds.has(participantId),
          )
      ))
      .map((actor) => actor.actorId),
  );
}

export function buildAigmSessionControlContext() {
  if (!currentSnapshot) {
    return null;
  }

  return Object.freeze({
    sessionId: currentSnapshot.sessionId,
    revision: currentSnapshot.revision,
    participants: Object.freeze(
      currentSnapshot.participants.map((participant) => Object.freeze({
        participantId: participant.participantId,
        attendance: participant.attendance,
      })),
    ),
    actors: Object.freeze(
      currentSnapshot.actors.map((actor) => Object.freeze({
        actorId: actor.actorId,
        campaignCharacterId: actor.campaignCharacterId,
        active: actor.active,
        controllerParticipantIds: actor.controllerParticipantIds,
      })),
    ),
  });
}
