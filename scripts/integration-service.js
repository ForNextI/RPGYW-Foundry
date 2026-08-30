import {
  createIntegrationApiClient,
} from "./api-client.js";
import {
  createPairingManager,
} from "./pairing.js";
import {
  MODULE_ID,
  SETTING_KEYS,
} from "./settings.js";

let integrationService = null;

function requireNonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${label} must be a non-empty string.`);
  }

  return value.trim();
}

function getWorldId() {
  return game.settings.get(
    MODULE_ID,
    SETTING_KEYS.integratorWorldId,
  ) || null;
}

function getFoundryUserId() {
  return game.user?.id ?? null;
}

function getFoundryUserName() {
  return game.user?.name ?? null;
}

function getFoundryWorldLabel() {
  return game.world?.title ?? null;
}

function buildPairingContext() {
  return Object.freeze({
    integratorWorldId: requireNonEmptyString(
      getWorldId(),
      "integratorWorldId",
    ),
    foundryUserId: requireNonEmptyString(
      getFoundryUserId(),
      "foundryUserId",
    ),
    foundryUserName: getFoundryUserName(),
    foundryWorldLabel: getFoundryWorldLabel(),
  });
}

function createRuntimeStatus(apiClient, pairingManager) {
  const pairing = pairingManager.getState();

  return Object.freeze({
    worldReady: Boolean(getWorldId()),
    foundryUserReady: Boolean(getFoundryUserId()),
    paired: pairing.state === "paired",
    hasSessionGrant: Boolean(apiClient.getSessionGrant()),
    pairing,
  });
}

export function createIntegrationService({
  apiClient = createIntegrationApiClient(),
  pairingManager = null,
} = {}) {
  const manager = pairingManager ?? createPairingManager({
    apiClient,
  });

  const listeners = new Set();

  function notify() {
    const status = getStatus();

    for (const listener of listeners) {
      listener(status);
    }

    return status;
  }

  function getStatus() {
    return createRuntimeStatus(apiClient, manager);
  }

  function subscribe(listener) {
    if (typeof listener !== "function") {
      throw new TypeError("listener must be a function.");
    }

    listeners.add(listener);

    return () => {
      listeners.delete(listener);
    };
  }

  async function beginPairing() {
    const result = await manager.beginPairing(
      buildPairingContext(),
    );

    notify();

    manager.startPolling({
      onChange: () => {
        notify();
      },
    });

    return result;
  }

  function resumePairing(pairingState) {
    const result = manager.resumePairing(pairingState);

    notify();

    if (result.state === "awaiting-approval") {
      manager.startPolling({
        onChange: () => {
          notify();
        },
      });
    }

    return result;
  }

  async function pollPairingOnce() {
    const result = await manager.pollOnce();
    notify();
    return result;
  }

  function stopPairingPolling() {
    manager.stopPolling();
  }

  function resetPairing() {
    const result = manager.reset();
    notify();
    return result;
  }

  async function requestAuthenticated(path, options = {}) {
    return apiClient.requestJson(path, {
      ...options,
      authenticated: true,
    });
  }

  return Object.freeze({
    getStatus,
    subscribe,
    beginPairing,
    resumePairing,
    pollPairingOnce,
    stopPairingPolling,
    resetPairing,
    requestAuthenticated,
  });
}

export function initializeIntegrationService() {
  if (integrationService) {
    return integrationService;
  }

  integrationService = createIntegrationService();
  return integrationService;
}

export function getIntegrationService() {
  if (!integrationService) {
    throw new Error(
      "RPG Your Way integration service has not been initialized.",
    );
  }

  return integrationService;
}
