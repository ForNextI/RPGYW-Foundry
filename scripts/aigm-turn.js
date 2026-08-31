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
      },
    },
  );

  return Object.freeze({
    input: message,
    ...normalizeResponse(result),
  });
}
