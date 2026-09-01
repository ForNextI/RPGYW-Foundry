import {
  FOUNDRY_API_PATHS,
} from "./api-client.js";

function requireMessage(value) {
  const message = String(value ?? "").trim();

  if (!message) {
    throw new Error("Type an action or question after /aigm.");
  }

  if (message.length > 1800) {
    throw new Error("Foundry AIGM messages are limited to 1800 characters.");
  }

  return message;
}

function foundryTableSnapshot() {
  const scene = canvas?.scene ?? null;
  if (!scene) return null;

  const combat = game.combat?.scene?.id === scene.id
    ? game.combat
    : null;

  return {
    version: 1,
    scene: {
      id: scene.id,
      name: scene.name,
      width: Number(scene.width) || 0,
      height: Number(scene.height) || 0,
      gridSize: Number(scene.grid?.size) || 100,
      gridDistance: Number(scene.grid?.distance) || 5,
      gridUnits: String(scene.grid?.units || "ft"),
    },
    combat: combat
      ? {
          started: combat.started === true,
          round: Number(combat.round) || 0,
          turn: Number.isFinite(combat.turn) ? Number(combat.turn) : null,
          combatants: Array.from(combat.combatants ?? []).map((entry) => ({
            name: String(entry.name || ""),
            tokenId: String(entry.tokenId || ""),
            initiative: Number.isFinite(entry.initiative)
              ? Number(entry.initiative)
              : null,
            defeated: Boolean(entry.isDefeated ?? entry.defeated),
          })),
        }
      : null,
    tokens: Array.from(scene.tokens ?? []).map((token) => ({
      id: String(token.id || ""),
      name: String(token.name || ""),
      campaignCharacterId: String(
        token.actor?.getFlag?.(
          "rpg-your-way-integrator",
          "campaignCharacterId",
        ) || "",
      ),
      combatantId: String(
        token.actor?.getFlag?.(
          "rpg-your-way-integrator",
          "combatantId",
        ) || "",
      ),
      x: Number(token.x) || 0,
      y: Number(token.y) || 0,
      width: Number(token.width) || 1,
      height: Number(token.height) || 1,
      disposition: Number(token.disposition) || 0,
    })),
  };
}

function normalizeResponse(value) {
  if (
    !value
      || typeof value !== "object"
      || Array.isArray(value)
      || value.version !== 1
      || typeof value.message !== "string"
  ) {
    throw new Error("RPG Your Way returned an invalid AIGM turn.");
  }

  return Object.freeze({
    turnId: String(value.turnId || ""),
    campaignRevision: Number(value.campaignRevision) || 0,
    playerDisplayName: String(value.playerDisplayName || game.user?.name || "Player"),
    playerCharacterNames: Array.isArray(value.playerCharacterNames)
      ? value.playerCharacterNames.filter((entry) => typeof entry === "string")
      : [],
    gameMasterName: String(value.gameMasterName || "RPG Your Way"),
    message: value.message,
    scene: String(value.scene || ""),
    combatSuggested: value.combatSuggested === true,
    vttQueued: value.vttQueued === true,
    vttWarning: String(value.vttWarning || ""),
    billing: value.billing ?? null,
  });
}

export async function sendAigmTurn(service, rawMessage) {
  const status = service.getStatus();

  if (!status.playerLink.hasSessionGrant) {
    throw new Error(
      "This Foundry user needs an active RPG Your Way player link before using /aigm.",
    );
  }

  const message = requireMessage(rawMessage);
  const result = await service.requestPlayerAuthenticated(
    FOUNDRY_API_PATHS.aigmTurn,
    {
      method: "POST",
      timeoutMs: 65_000,
      body: {
        version: 1,
        message,
        tableSnapshot: foundryTableSnapshot(),
      },
    },
  );

  return Object.freeze({
    input: message,
    ...normalizeResponse(result),
  });
}
