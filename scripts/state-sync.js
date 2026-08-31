import {
  FOUNDRY_API_PATHS,
} from "./api-client.js";
import {
  canRunIntegratorActions,
} from "./controller.js";
import {
  ensureFoundryRoster,
  getCampaignCharacterForActor,
} from "./mapping-service.js";
import {
  MODULE_ID,
  SETTING_KEYS,
} from "./settings.js";

let syncChain = Promise.resolve();

function changedPosition(changes) {
  return Boolean(
    changes
      && typeof changes === "object"
      && (
        Object.prototype.hasOwnProperty.call(changes, "x")
          || Object.prototype.hasOwnProperty.call(changes, "y")
      )
  );
}

function finiteCoordinate(value, label) {
  const number = Number(value);

  if (!Number.isFinite(number) || number < 0) {
    throw new TypeError(`${label} must be a non-negative finite number.`);
  }

  return number;
}

async function syncMappedToken(
  service,
  tokenDocument,
  sourceFoundryUserId,
) {
  if (!canRunIntegratorActions()) {
    return null;
  }

  if (!service.getStatus().hasSessionGrant) {
    return null;
  }

  const actorId = (
    tokenDocument.actorId
      || tokenDocument.actor?.id
      || null
  );

  if (!actorId) {
    return null;
  }

  const roster = await ensureFoundryRoster(service);
  const character = getCampaignCharacterForActor(String(actorId));

  if (!character) {
    return null;
  }

  const sceneId = tokenDocument.parent?.id ?? canvas?.scene?.id ?? null;

  if (!sceneId || !tokenDocument.id) {
    return null;
  }

  const x = finiteCoordinate(tokenDocument.x, "token x");
  const y = finiteCoordinate(tokenDocument.y, "token y");

  const response = await service.requestAuthenticated(
    FOUNDRY_API_PATHS.stateSync,
    {
      method: "POST",
      body: {
        version: 1,
        kind: "token-position",
        eventId: crypto.randomUUID(),
        sessionId: roster.sessionId,
        campaignCharacterId: character.campaignCharacterId,
        foundryActorId: String(actorId),
        foundryTokenId: String(tokenDocument.id),
        sceneId: String(sceneId),
        x,
        y,
        sourceFoundryUserId: (
          typeof sourceFoundryUserId === "string"
            ? sourceFoundryUserId
            : null
        ),
      },
    },
  );

  if (
    response?.accepted
      && game.settings.get(
        MODULE_ID,
        SETTING_KEYS.showIntegratorNotifications,
      )
  ) {
    ui.notifications.info(
      `RPG Your Way received ${character.displayName} at ${x}, ${y}.`,
    );
  }

  return response;
}

function enqueueSync(task) {
  syncChain = syncChain.then(task, task);
  return syncChain;
}

export function initializeFoundryStateSync(service) {
  Hooks.on(
    "updateToken",
    (tokenDocument, changes, _options, userId) => {
      if (!changedPosition(changes)) {
        return;
      }

      void enqueueSync(
        () => syncMappedToken(service, tokenDocument, userId),
      ).catch((error) => {
        console.warn(
          `${MODULE_ID} | Foundry state sync failed`,
          error,
        );
      });
    },
  );

  return Object.freeze({
    syncToken: (tokenDocument, sourceFoundryUserId = null) => (
      enqueueSync(
        () => syncMappedToken(
          service,
          tokenDocument,
          sourceFoundryUserId,
        ),
      )
    ),
  });
}
