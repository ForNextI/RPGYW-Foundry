const PAIRING_STATES = Object.freeze({
  idle: "idle",
  awaitingApproval: "awaiting-approval",
  paired: "paired",
  denied: "denied",
  expired: "expired",
  error: "error",
});

const SERVER_STATUS_VALUES = new Set([
  "pending",
  "approved",
  "denied",
  "expired",
]);

const DEFAULT_POLL_INTERVAL_MS = 2_000;

function isPlainObject(value) {
  return Boolean(
    value
      && typeof value === "object"
      && !Array.isArray(value),
  );
}

function requireNonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${label} must be a non-empty string.`);
  }

  return value.trim();
}

function normalizeExpiresAt(value, label) {
  const normalized = requireNonEmptyString(value, label);
  const timestamp = Date.parse(normalized);

  if (Number.isNaN(timestamp)) {
    throw new TypeError(`${label} must be an ISO-compatible date string.`);
  }

  return Object.freeze({
    value: normalized,
    timestamp,
  });
}

function normalizeStartResponse(response) {
  if (!isPlainObject(response)) {
    throw new TypeError("Pairing start response must be an object.");
  }

  const pairId = requireNonEmptyString(response.pairId, "pairId");
  const userCode = requireNonEmptyString(response.userCode, "userCode");
  const verificationUrl = requireNonEmptyString(
    response.verificationUrl,
    "verificationUrl",
  );
  const expiresAt = normalizeExpiresAt(response.expiresAt, "expiresAt");

  let parsedVerificationUrl;

  try {
    parsedVerificationUrl = new URL(verificationUrl);
  } catch {
    throw new TypeError("verificationUrl must be a valid URL.");
  }

  if (parsedVerificationUrl.protocol !== "https:") {
    throw new TypeError("verificationUrl must use HTTPS.");
  }

  return Object.freeze({
    pairId,
    userCode,
    verificationUrl,
    expiresAt: expiresAt.value,
    expiresAtTimestamp: expiresAt.timestamp,
  });
}

function normalizeStatusResponse(response) {
  if (!isPlainObject(response)) {
    throw new TypeError("Pairing status response must be an object.");
  }

  if (!SERVER_STATUS_VALUES.has(response.status)) {
    throw new TypeError(
      "Pairing status must be pending, approved, denied, or expired.",
    );
  }

  if (response.status === "approved") {
    return Object.freeze({
      status: "approved",
      sessionGrant: requireNonEmptyString(
        response.sessionGrant,
        "sessionGrant",
      ),
    });
  }

  return Object.freeze({
    status: response.status,
    sessionGrant: null,
  });
}

function clonePublicState(state) {
  return Object.freeze({
    state: state.state,
    pairId: state.pairId,
    userCode: state.userCode,
    verificationUrl: state.verificationUrl,
    expiresAt: state.expiresAt,
    error: state.error,
  });
}

export function createPairingManager({
  apiClient,
  now = () => Date.now(),
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
} = {}) {
  if (
    !apiClient
      || typeof apiClient.startPairing !== "function"
      || typeof apiClient.getPairingStatus !== "function"
      || typeof apiClient.setSessionGrant !== "function"
      || typeof apiClient.clearSessionGrant !== "function"
  ) {
    throw new TypeError("A compatible integration API client is required.");
  }

  if (typeof now !== "function") {
    throw new TypeError("now must be a function.");
  }

  if (!Number.isFinite(pollIntervalMs) || pollIntervalMs <= 0) {
    throw new TypeError("pollIntervalMs must be a positive number.");
  }

  let state = {
    state: PAIRING_STATES.idle,
    pairId: null,
    userCode: null,
    verificationUrl: null,
    expiresAt: null,
    expiresAtTimestamp: null,
    error: null,
  };

  let pollTimer = null;
  let pollInFlight = false;
  let onStateChange = null;

  function emitState() {
    onStateChange?.(clonePublicState(state));
  }

  function replaceState(nextState) {
    state = {
      ...state,
      ...nextState,
    };

    emitState();
    return clonePublicState(state);
  }

  function stopPolling() {
    if (pollTimer !== null) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function reset() {
    stopPolling();
    pollInFlight = false;
    apiClient.clearSessionGrant();

    state = {
      state: PAIRING_STATES.idle,
      pairId: null,
      userCode: null,
      verificationUrl: null,
      expiresAt: null,
      expiresAtTimestamp: null,
      error: null,
    };

    emitState();
    return clonePublicState(state);
  }

  function isLocallyExpired() {
    return Boolean(
      state.expiresAtTimestamp
        && now() >= state.expiresAtTimestamp,
    );
  }

  async function beginPairing(pairingContext) {
    reset();

    try {
      const startResponse = normalizeStartResponse(
        await apiClient.startPairing(pairingContext),
      );

      state = {
        state: PAIRING_STATES.awaitingApproval,
        pairId: startResponse.pairId,
        userCode: startResponse.userCode,
        verificationUrl: startResponse.verificationUrl,
        expiresAt: startResponse.expiresAt,
        expiresAtTimestamp: startResponse.expiresAtTimestamp,
        error: null,
      };

      emitState();
      return clonePublicState(state);
    } catch (error) {
      replaceState({
        state: PAIRING_STATES.error,
        error,
      });

      throw error;
    }
  }

  function resumePairing({
    pairId,
    userCode,
    verificationUrl,
    expiresAt,
  }) {
    stopPolling();
    apiClient.clearSessionGrant();

    const normalized = normalizeStartResponse({
      pairId,
      userCode,
      verificationUrl,
      expiresAt,
    });

    state = {
      state: (
        now() >= normalized.expiresAtTimestamp
          ? PAIRING_STATES.expired
          : PAIRING_STATES.awaitingApproval
      ),
      pairId: normalized.pairId,
      userCode: normalized.userCode,
      verificationUrl: normalized.verificationUrl,
      expiresAt: normalized.expiresAt,
      expiresAtTimestamp: normalized.expiresAtTimestamp,
      error: null,
    };

    emitState();
    return clonePublicState(state);
  }

  async function pollOnce() {
    if (state.state !== PAIRING_STATES.awaitingApproval) {
      return clonePublicState(state);
    }

    if (isLocallyExpired()) {
      stopPolling();

      return replaceState({
        state: PAIRING_STATES.expired,
      });
    }

    if (pollInFlight) {
      return clonePublicState(state);
    }

    pollInFlight = true;

    try {
      const status = normalizeStatusResponse(
        await apiClient.getPairingStatus(state.pairId),
      );

      if (status.status === "pending") {
        return clonePublicState(state);
      }

      if (status.status === "approved") {
        apiClient.setSessionGrant(status.sessionGrant);
        stopPolling();

        return replaceState({
          state: PAIRING_STATES.paired,
          error: null,
        });
      }

      stopPolling();

      return replaceState({
        state: (
          status.status === "denied"
            ? PAIRING_STATES.denied
            : PAIRING_STATES.expired
        ),
        error: null,
      });
    } catch (error) {
      stopPolling();

      replaceState({
        state: PAIRING_STATES.error,
        error,
      });

      throw error;
    } finally {
      pollInFlight = false;
    }
  }

  function startPolling({ onChange = null } = {}) {
    if (onChange !== null && typeof onChange !== "function") {
      throw new TypeError("onChange must be a function when provided.");
    }

    onStateChange = onChange;

    if (state.state !== PAIRING_STATES.awaitingApproval) {
      return false;
    }

    if (pollTimer !== null) {
      return true;
    }

    void pollOnce().catch(() => {});

    pollTimer = setInterval(
      () => {
        void pollOnce().catch(() => {});
      },
      pollIntervalMs,
    );

    return true;
  }

  function getState() {
    return clonePublicState(state);
  }

  return Object.freeze({
    beginPairing,
    resumePairing,
    pollOnce,
    startPolling,
    stopPolling,
    reset,
    getState,
  });
}
