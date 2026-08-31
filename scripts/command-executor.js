import {
  canRunIntegratorActions,
} from "./controller.js";
import {
  MODULE_ID,
  SETTING_KEYS,
} from "./settings.js";

const COMMAND_KEYS = new Set([
  "version",
  "commandId",
  "type",
  "sceneId",
  "tokenId",
  "x",
  "y",
]);

const executedCommandIds = new Set();
const executedCommandOrder = [];
const MAX_REMEMBERED_COMMANDS = 512;

function requirePlainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }

  return value;
}

function requireExactKeys(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new TypeError(`${label} contains unsupported field "${key}".`);
    }
  }
}

function requireString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${label} must be a non-empty string.`);
  }

  return value.trim();
}

function requireCoordinate(value, label) {
  const number = Number(value);

  if (!Number.isFinite(number) || number < 0) {
    throw new TypeError(`${label} must be a non-negative finite number.`);
  }

  return number;
}

function normalizeCommand(rawCommand) {
  const command = requirePlainObject(rawCommand, "Integrator command");
  requireExactKeys(command, COMMAND_KEYS, "Integrator command");

  if (command.version !== 1) {
    throw new TypeError("Integrator command version must be 1.");
  }

  if (command.type !== "token.move") {
    throw new TypeError(`Unsupported Integrator command type "${command.type}".`);
  }

  return Object.freeze({
    version: 1,
    commandId: requireString(command.commandId, "commandId"),
    type: "token.move",
    sceneId: requireString(command.sceneId, "sceneId"),
    tokenId: requireString(command.tokenId, "tokenId"),
    x: requireCoordinate(command.x, "x"),
    y: requireCoordinate(command.y, "y"),
  });
}

function rememberCommand(commandId) {
  if (executedCommandIds.has(commandId)) {
    return false;
  }

  executedCommandIds.add(commandId);
  executedCommandOrder.push(commandId);

  while (executedCommandOrder.length > MAX_REMEMBERED_COMMANDS) {
    const oldest = executedCommandOrder.shift();
    if (oldest) executedCommandIds.delete(oldest);
  }

  return true;
}

function tokenMovementAllowed({ explicitProbe }) {
  if (explicitProbe) {
    return true;
  }

  return Boolean(
    game.settings.get(
      MODULE_ID,
      SETTING_KEYS.allowAIGMTokenMovement,
    ),
  );
}

function validateSceneBounds(scene, token, x, y) {
  const gridSize = Number(scene.grid?.size);
  const sceneWidth = Number(scene.width);
  const sceneHeight = Number(scene.height);
  const tokenWidth = Number(token.width);
  const tokenHeight = Number(token.height);

  if (
    !Number.isFinite(gridSize)
      || gridSize <= 0
      || !Number.isFinite(sceneWidth)
      || !Number.isFinite(sceneHeight)
      || !Number.isFinite(tokenWidth)
      || !Number.isFinite(tokenHeight)
  ) {
    throw new Error("Foundry could not validate the token movement bounds.");
  }

  const maxX = Math.max(0, sceneWidth - (tokenWidth * gridSize));
  const maxY = Math.max(0, sceneHeight - (tokenHeight * gridSize));

  if (x > maxX || y > maxY) {
    throw new Error("The Integrator command would move the token outside the scene.");
  }
}

export async function executeIntegratorCommand(
  rawCommand,
  { explicitProbe = false } = {},
) {
  if (!canRunIntegratorActions()) {
    throw new Error(
      "This Foundry client is not the active RPG Your Way Integrator controller.",
    );
  }

  if (!tokenMovementAllowed({ explicitProbe })) {
    throw new Error("RPG Your Way token movement is not enabled for this world.");
  }

  const command = normalizeCommand(rawCommand);

  if (executedCommandIds.has(command.commandId)) {
    return Object.freeze({
      version: 1,
      commandId: command.commandId,
      status: "duplicate",
      sceneId: command.sceneId,
      tokenId: command.tokenId,
      x: command.x,
      y: command.y,
    });
  }

  const scene = game.scenes.get(command.sceneId);

  if (!scene || canvas?.scene?.id !== command.sceneId) {
    throw new Error("The Integrator command targets a scene that is not currently active.");
  }

  const token = scene.tokens.get(command.tokenId);

  if (!token) {
    throw new Error("The Integrator command targets a token that is not on the active scene.");
  }

  validateSceneBounds(scene, token, command.x, command.y);

  await token.update({
    x: command.x,
    y: command.y,
  });

  rememberCommand(command.commandId);

  return Object.freeze({
    version: 1,
    commandId: command.commandId,
    status: "applied",
    sceneId: command.sceneId,
    tokenId: command.tokenId,
    x: command.x,
    y: command.y,
  });
}
