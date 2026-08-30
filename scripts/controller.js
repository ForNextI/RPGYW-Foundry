import { MODULE_ID, SETTING_KEYS } from "./settings.js";

const SOCKET_NAME = `module.${MODULE_ID}`;
const HEARTBEAT_TYPE = "controller.heartbeat";
const HEARTBEAT_INTERVAL_MS = 5_000;
const HEARTBEAT_TIMEOUT_MS = 15_000;

let heartbeatTimer = null;
let lastControllerHeartbeatAt = 0;

function getControllerUserId() {
  return game.settings.get(MODULE_ID, SETTING_KEYS.controllerUserId) || null;
}

function getWorldId() {
  return game.settings.get(MODULE_ID, SETTING_KEYS.integratorWorldId) || null;
}

function getUserById(userId) {
  if (!userId) {
    return null;
  }

  return game.users.get(userId) ?? null;
}

function isActiveGm(user) {
  return Boolean(user?.active && user?.isGM);
}

function isCurrentUserController() {
  const controllerUserId = getControllerUserId();

  return Boolean(
    controllerUserId
      && game.user?.id === controllerUserId
      && isActiveGm(game.user),
  );
}

function stopHeartbeat() {
  if (heartbeatTimer === null) {
    return;
  }

  clearInterval(heartbeatTimer);
  heartbeatTimer = null;
}

function sendHeartbeat() {
  if (!isCurrentUserController()) {
    stopHeartbeat();
    return;
  }

  const worldId = getWorldId();

  if (!worldId) {
    return;
  }

  const now = Date.now();

  game.socket.emit(SOCKET_NAME, {
    version: 1,
    type: HEARTBEAT_TYPE,
    userId: game.user.id,
    worldId,
  });

  lastControllerHeartbeatAt = now;
}

function startHeartbeat() {
  if (!isCurrentUserController() || heartbeatTimer !== null) {
    return;
  }

  sendHeartbeat();
  heartbeatTimer = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);
}

function receiveHeartbeat(message) {
  if (!message || message.type !== HEARTBEAT_TYPE || message.version !== 1) {
    return;
  }

  const controllerUserId = getControllerUserId();
  const worldId = getWorldId();

  if (
    !controllerUserId
      || message.userId !== controllerUserId
      || !worldId
      || message.worldId !== worldId
  ) {
    return;
  }

  const controllerUser = getUserById(controllerUserId);

  if (!isActiveGm(controllerUser)) {
    return;
  }

  lastControllerHeartbeatAt = Date.now();
}

export function getControllerStatus() {
  const controllerUserId = getControllerUserId();

  if (!controllerUserId) {
    return Object.freeze({
      state: "unassigned",
      controllerUserId: null,
      operational: false,
    });
  }

  const controllerUser = getUserById(controllerUserId);

  if (!isActiveGm(controllerUser)) {
    return Object.freeze({
      state: "controller-offline",
      controllerUserId,
      operational: false,
    });
  }

  if (isCurrentUserController()) {
    return Object.freeze({
      state: "local-controller",
      controllerUserId,
      operational: true,
    });
  }

  const heartbeatAgeMs = Date.now() - lastControllerHeartbeatAt;
  const heartbeatFresh = (
    lastControllerHeartbeatAt > 0
      && heartbeatAgeMs <= HEARTBEAT_TIMEOUT_MS
  );

  return Object.freeze({
    state: heartbeatFresh ? "remote-controller" : "controller-stale",
    controllerUserId,
    operational: heartbeatFresh,
  });
}

export function canRunIntegratorActions() {
  const integratorEnabled = game.settings.get(
    MODULE_ID,
    SETTING_KEYS.integratorEnabled,
  );

  return Boolean(
    integratorEnabled
      && getWorldId()
      && isCurrentUserController(),
  );
}

export async function claimController({ takeover = false } = {}) {
  if (!isActiveGm(game.user)) {
    throw new Error("Only an active Foundry GM can control the Integrator.");
  }

  const existingControllerUserId = getControllerUserId();

  if (
    existingControllerUserId
      && existingControllerUserId !== game.user.id
      && !takeover
  ) {
    throw new Error(
      "Another GM is already configured as Integrator controller.",
    );
  }

  await game.settings.set(
    MODULE_ID,
    SETTING_KEYS.controllerUserId,
    game.user.id,
  );

  lastControllerHeartbeatAt = Date.now();
  startHeartbeat();

  return getControllerStatus();
}

export async function releaseController() {
  const controllerUserId = getControllerUserId();

  if (!controllerUserId) {
    return getControllerStatus();
  }

  if (controllerUserId !== game.user?.id || !isActiveGm(game.user)) {
    throw new Error(
      "Only the configured active GM can release Integrator control.",
    );
  }

  stopHeartbeat();
  lastControllerHeartbeatAt = 0;

  await game.settings.set(
    MODULE_ID,
    SETTING_KEYS.controllerUserId,
    "",
  );

  return getControllerStatus();
}

export function initializeController() {
  game.socket.on(SOCKET_NAME, receiveHeartbeat);

  if (isCurrentUserController()) {
    startHeartbeat();
  }

  return Object.freeze({
    status: getControllerStatus,
    canRunActions: canRunIntegratorActions,
    claim: claimController,
    release: releaseController,
  });
}
