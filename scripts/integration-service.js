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

function createPlayerPairingApi(apiClient) {
  return Object.freeze({
    startPairing: (context) => apiClient.startPlayerLink(context),
    getPairingStatus: (pairId) => apiClient.getPlayerLinkStatus(pairId),
    setSessionGrant: (grant) => apiClient.setSessionGrant(grant),
    clearSessionGrant: () => apiClient.clearSessionGrant(),
  });
}

function createRuntimeStatus(
  apiClient,
  pairingManager,
  playerApiClient,
  playerPairingManager,
) {
  const pairing = pairingManager.getState();
  const playerPairing = playerPairingManager.getState();

  return Object.freeze({
    worldReady: Boolean(getWorldId()),
    foundryUserReady: Boolean(getFoundryUserId()),
    paired: pairing.state === "paired",
    hasSessionGrant: Boolean(apiClient.getSessionGrant()),
    pairing,
    playerLink: Object.freeze({
      paired: playerPairing.state === "paired",
      hasSessionGrant: Boolean(playerApiClient.getSessionGrant()),
      pairing: playerPairing,
    }),
  });
}

export function createIntegrationService({
  apiClient = createIntegrationApiClient(),
  pairingManager = null,
  playerApiClient = createIntegrationApiClient(),
  playerPairingManager = null,
} = {}) {
  const manager = pairingManager ?? createPairingManager({
    apiClient,
  });

  const playerManager = playerPairingManager ?? createPairingManager({
    apiClient: createPlayerPairingApi(playerApiClient),
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
    return createRuntimeStatus(
      apiClient,
      manager,
      playerApiClient,
      playerManager,
    );
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

  function startManagerPolling(targetManager) {
    targetManager.startPolling({
      onChange: () => {
        notify();
      },
    });
  }

  async function beginPairing() {
    const result = await manager.beginPairing(
      buildPairingContext(),
    );

    notify();
    startManagerPolling(manager);
    return result;
  }

  async function beginPlayerLink() {
    const result = await playerManager.beginPairing(
      buildPairingContext(),
    );

    notify();
    startManagerPolling(playerManager);
    return result;
  }

  function resumePairing(pairingState) {
    const result = manager.resumePairing(pairingState);

    notify();

    if (result.state === "awaiting-approval") {
      startManagerPolling(manager);
    }

    return result;
  }

  function resumePlayerLink(pairingState) {
    const result = playerManager.resumePairing(pairingState);

    notify();

    if (result.state === "awaiting-approval") {
      startManagerPolling(playerManager);
    }

    return result;
  }

  async function pollPairingOnce() {
    const result = await manager.pollOnce();
    notify();
    return result;
  }

  async function pollPlayerLinkOnce() {
    const result = await playerManager.pollOnce();
    notify();
    return result;
  }

  function stopPairingPolling() {
    manager.stopPolling();
  }

  function stopPlayerLinkPolling() {
    playerManager.stopPolling();
  }

  function resetPairing() {
    const result = manager.reset();
    notify();
    return result;
  }

  function resetPlayerLink() {
    const result = playerManager.reset();
    notify();
    return result;
  }

  async function requestAuthenticated(path, options = {}) {
    return apiClient.requestJson(path, {
      ...options,
      authenticated: true,
    });
  }

  async function requestPlayerAuthenticated(path, options = {}) {
    return playerApiClient.requestJson(path, {
      ...options,
      authenticated: true,
    });
  }

  async function getConnection() {
    return apiClient.getConnection();
  }

  async function getPlayerLink() {
    return playerApiClient.getPlayerLink();
  }

  return Object.freeze({
    getStatus,
    subscribe,
    beginPairing,
    beginPlayerLink,
    resumePairing,
    resumePlayerLink,
    pollPairingOnce,
    pollPlayerLinkOnce,
    stopPairingPolling,
    stopPlayerLinkPolling,
    resetPairing,
    resetPlayerLink,
    requestAuthenticated,
    requestPlayerAuthenticated,
    getConnection,
    getPlayerLink,
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
