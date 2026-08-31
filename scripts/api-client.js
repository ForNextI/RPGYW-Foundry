export const RPGYW_API_ORIGIN = "https://rpgyourway.com";

export const FOUNDRY_API_ROOT = (
  `${RPGYW_API_ORIGIN}/api/integrations/foundry`
);

export const FOUNDRY_API_PATHS = Object.freeze({
  pairStart: "/pair/start",
  pairStatus: "/pair/status",
  connection: "/connection",
  sessionOpen: "/session/open",
  sessionHeartbeat: "/session/heartbeat",
  sessionRoster: "/session/roster",
  sessionClose: "/session/close",
  turn: "/turn",
  commandResult: "/command-result",
  stateSync: "/state-sync",
});

const DEFAULT_TIMEOUT_MS = 10_000;

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

function normalizeBaseUrl(baseUrl) {
  return requireNonEmptyString(baseUrl, "baseUrl").replace(/\/+$/, "");
}

function parseRetryAfterMs(response) {
  const header = response.headers?.get?.("retry-after");

  if (!header) {
    return null;
  }

  const seconds = Number(header);

  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.round(seconds * 1000);
  }

  const retryAt = Date.parse(header);

  if (!Number.isNaN(retryAt)) {
    return Math.max(0, retryAt - Date.now());
  }

  return null;
}

async function readResponseBody(response) {
  const contentType = response.headers?.get?.("content-type") ?? "";

  if (contentType.includes("application/json")) {
    try {
      return await response.json();
    } catch {
      return null;
    }
  }

  try {
    const text = await response.text();
    return text === "" ? null : text;
  } catch {
    return null;
  }
}

export class IntegrationApiError extends Error {
  constructor(
    message,
    {
      status = null,
      code = null,
      retryAfterMs = null,
      body = null,
      cause = null,
    } = {},
  ) {
    super(message, cause ? { cause } : undefined);
    this.name = "IntegrationApiError";
    this.status = status;
    this.code = code;
    this.retryAfterMs = retryAfterMs;
    this.body = body;
  }
}

export function createIntegrationApiClient({
  baseUrl = FOUNDRY_API_ROOT,
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  if (typeof fetchImpl !== "function") {
    throw new TypeError("A fetch implementation is required.");
  }

  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError("timeoutMs must be a positive number.");
  }

  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  let sessionGrant = null;

  function getSessionGrant() {
    return sessionGrant;
  }

  function setSessionGrant(grant) {
    sessionGrant = requireNonEmptyString(grant, "sessionGrant");
    return sessionGrant;
  }

  function clearSessionGrant() {
    sessionGrant = null;
  }

  async function requestJson(
    path,
    {
      method = "GET",
      body = null,
      authenticated = false,
      query = null,
    } = {},
  ) {
    const normalizedPath = requireNonEmptyString(path, "path");

    if (!normalizedPath.startsWith("/")) {
      throw new TypeError("Integration API paths must begin with '/'.");
    }

    const url = new URL(`${normalizedBaseUrl}${normalizedPath}`);

    if (query !== null) {
      if (!isPlainObject(query)) {
        throw new TypeError("query must be an object when provided.");
      }

      for (const [key, value] of Object.entries(query)) {
        if (value !== null && value !== undefined) {
          url.searchParams.set(key, String(value));
        }
      }
    }

    const headers = new Headers({
      Accept: "application/json",
    });

    if (body !== null) {
      headers.set("Content-Type", "application/json");
    }

    if (authenticated) {
      if (!sessionGrant) {
        throw new IntegrationApiError(
          "No integration session grant is available.",
          { code: "missing-session-grant" },
        );
      }

      headers.set("Authorization", `Bearer ${sessionGrant}`);
    }

    const abortController = new AbortController();
    const timeoutHandle = setTimeout(
      () => abortController.abort(),
      timeoutMs,
    );

    let response;

    try {
      response = await fetchImpl(url, {
        method,
        headers,
        body: body === null ? undefined : JSON.stringify(body),
        credentials: "omit",
        mode: "cors",
        signal: abortController.signal,
      });
    } catch (cause) {
      if (cause?.name === "AbortError") {
        throw new IntegrationApiError(
          "RPG Your Way integration request timed out.",
          { code: "timeout", cause },
        );
      }

      throw new IntegrationApiError(
        "RPG Your Way integration request failed.",
        { code: "network-error", cause },
      );
    } finally {
      clearTimeout(timeoutHandle);
    }

    const responseBody = await readResponseBody(response);

    if (!response.ok) {
      if (authenticated && response.status === 401) {
        clearSessionGrant();
      }

      throw new IntegrationApiError(
        `RPG Your Way integration API returned HTTP ${response.status}.`,
        {
          status: response.status,
          code: (
            isPlainObject(responseBody)
              && typeof responseBody.code === "string"
          )
            ? responseBody.code
            : null,
          retryAfterMs: parseRetryAfterMs(response),
          body: responseBody,
        },
      );
    }

    return responseBody;
  }

  async function startPairing({
    integratorWorldId,
    foundryUserId,
    foundryUserName = null,
    foundryWorldLabel = null,
  }) {
    return requestJson(
      FOUNDRY_API_PATHS.pairStart,
      {
        method: "POST",
        body: {
          integratorWorldId: requireNonEmptyString(
            integratorWorldId,
            "integratorWorldId",
          ),
          foundryUserId: requireNonEmptyString(
            foundryUserId,
            "foundryUserId",
          ),
          foundryUserName,
          foundryWorldLabel,
        },
      },
    );
  }

  async function getPairingStatus(pairId) {
    return requestJson(
      FOUNDRY_API_PATHS.pairStatus,
      {
        method: "GET",
        query: {
          pairId: requireNonEmptyString(pairId, "pairId"),
        },
      },
    );
  }

  async function getConnection() {
    return requestJson(
      FOUNDRY_API_PATHS.connection,
      {
        method: "GET",
        authenticated: true,
      },
    );
  }

  return Object.freeze({
    requestJson,
    startPairing,
    getPairingStatus,
    getConnection,
    getSessionGrant,
    setSessionGrant,
    clearSessionGrant,
  });
}
