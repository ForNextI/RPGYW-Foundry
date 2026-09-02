import {
  createIntegrationApiClient,
  FOUNDRY_API_PATHS,
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

function getUserSetting(key) {
  return game.settings.get(MODULE_ID, key) || "";
}

async function setUserSetting(key, value) {
  await game.settings.set(MODULE_ID, key, String(value || ""));
}

function currentUserIsConfiguredController() {
  return Boolean(
    game.user?.isGM
      && game.settings.get(MODULE_ID, SETTING_KEYS.integratorEnabled)
      && game.settings.get(MODULE_ID, SETTING_KEYS.controllerUserId) === game.user.id,
  );
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
    setDeviceGrant: (grant) => apiClient.setDeviceGrant(grant),
    clearDeviceGrant: () => apiClient.clearDeviceGrant(),
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
    hasDeviceGrant: Boolean(apiClient.getDeviceGrant()),
    pairing,
    playerLink: Object.freeze({
      paired: playerPairing.state === "paired",
      hasSessionGrant: Boolean(playerApiClient.getSessionGrant()),
      hasDeviceGrant: Boolean(playerApiClient.getDeviceGrant()),
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

  async function persistControllerDeviceGrant() {
    const grant = apiClient.getDeviceGrant();
    if (!grant) return false;
    await setUserSetting(SETTING_KEYS.controllerDeviceGrant, grant);
    return true;
  }

  async function persistPlayerDeviceGrant() {
    const grant = playerApiClient.getDeviceGrant();
    if (!grant) return false;
    await setUserSetting(SETTING_KEYS.playerDeviceGrant, grant);
    return true;
  }

  async function forgetControllerDeviceGrant() {
    apiClient.clearSessionGrant();
    apiClient.clearDeviceGrant();
    await setUserSetting(SETTING_KEYS.controllerDeviceGrant, "");
  }

  async function forgetPlayerDeviceGrant() {
    playerApiClient.clearSessionGrant();
    playerApiClient.clearDeviceGrant();
    await setUserSetting(SETTING_KEYS.playerDeviceGrant, "");
  }

  async function refreshStoredSession(client, settingKey) {
    const stored = client.getDeviceGrant() || getUserSetting(settingKey);
    if (!stored) return false;

    if (!client.getDeviceGrant()) {
      client.setDeviceGrant(stored);
    }

    try {
      await client.refreshSession();
      const rotated = client.getDeviceGrant();
      if (rotated) {
        await setUserSetting(settingKey, rotated);
      }
      return true;
    } catch (error) {
      if (error?.status === 401 || error?.status === 403) {
        client.clearSessionGrant();
        client.clearDeviceGrant();
        await setUserSetting(settingKey, "");
      }

      console.warn(
        `${MODULE_ID} | could not restore persistent session`,
        error,
      );
      return false;
    }
  }

  async function restoreSessions() {
    const controller = currentUserIsConfiguredController()
      ? await refreshStoredSession(
          apiClient,
          SETTING_KEYS.controllerDeviceGrant,
        )
      : false;

    const player = await refreshStoredSession(
      playerApiClient,
      SETTING_KEYS.playerDeviceGrant,
    );

    notify();
    return Object.freeze({ controller, player });
  }

  async function beginPairing() {
    await forgetControllerDeviceGrant();
    const result = await manager.beginPairing(
      buildPairingContext(),
    );

    notify();
    startManagerPolling(manager);
    return result;
  }

  async function beginPlayerLink() {
    await forgetPlayerDeviceGrant();
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
    if (result.state === "paired") {
      await persistControllerDeviceGrant();
    }
    notify();
    return result;
  }

  async function pollPlayerLinkOnce() {
    const result = await playerManager.pollOnce();
    if (result.state === "paired") {
      await persistPlayerDeviceGrant();
    }
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
    try {
      return await apiClient.requestJson(path, {
        ...options,
        authenticated: true,
      });
    } catch (error) {
      if (
        error?.status === 401
          && await refreshStoredSession(
            apiClient,
            SETTING_KEYS.controllerDeviceGrant,
          )
      ) {
        return apiClient.requestJson(path, {
          ...options,
          authenticated: true,
        });
      }
      throw error;
    }
  }

  async function requestPlayerAuthenticated(path, options = {}) {
    try {
      return await playerApiClient.requestJson(path, {
        ...options,
        authenticated: true,
      });
    } catch (error) {
      if (
        error?.status === 401
          && await refreshStoredSession(
            playerApiClient,
            SETTING_KEYS.playerDeviceGrant,
          )
      ) {
        return playerApiClient.requestJson(path, {
          ...options,
          authenticated: true,
        });
      }
      throw error;
    }
  }

  async function getConnection() {
    return requestAuthenticated(FOUNDRY_API_PATHS.connection);
  }

  async function getPlayerLink() {
    return requestPlayerAuthenticated(FOUNDRY_API_PATHS.playerLink);
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
    restoreSessions,
    persistControllerDeviceGrant,
    persistPlayerDeviceGrant,
    forgetControllerDeviceGrant,
    forgetPlayerDeviceGrant,
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
