import {
  RPGYW_API_ORIGIN,
} from "./api-client.js";

const FOUNDRY_WINDOW_NAME = "rpgyw-foundry-vtt";
const WEB_WINDOW_NAME = "rpgyw-play";
const FOUNDRY_FOCUS_PING = "rpgyw.vtt.focus.ping";
const FOUNDRY_FOCUS_PONG = "rpgyw.vtt.focus.pong";
const WEB_FOCUS_PING = "rpgyw.web.focus.ping";
const WEB_FOCUS_PONG = "rpgyw.web.focus.pong";
const FOCUS_WAIT_MS = 300;

let bridgeInstalled = false;

function webOrigin() {
  return new URL(RPGYW_API_ORIGIN).origin;
}

export function installFoundryFocusBridge() {
  window.name = FOUNDRY_WINDOW_NAME;

  if (bridgeInstalled) {
    return;
  }

  window.addEventListener("message", (event) => {
    const data = event.data;

    if (
      event.origin !== webOrigin()
        || !data
        || typeof data !== "object"
        || data.source !== "rpgyw-web"
        || data.type !== FOUNDRY_FOCUS_PING
        || typeof data.requestId !== "string"
    ) {
      return;
    }

    try {
      window.focus();
    } catch {
      // Browser focus is best-effort.
    }

    event.source?.postMessage(
      {
        source: "rpgyw-foundry",
        type: FOUNDRY_FOCUS_PONG,
        requestId: data.requestId,
      },
      event.origin,
    );
  });

  bridgeInstalled = true;
}

export async function focusOrOpenRpgYourWay() {
  const url = `${RPGYW_API_ORIGIN}/play`;
  const targetOrigin = webOrigin();
  const candidate = window.open("", WEB_WINDOW_NAME);

  if (!candidate) {
    window.open(url, WEB_WINDOW_NAME);
    return;
  }

  const requestId = crypto.randomUUID();
  let acknowledged = false;

  const receivePong = (event) => {
    const data = event.data;

    if (
      event.origin === targetOrigin
        && data
        && typeof data === "object"
        && data.source === "rpgyw-web"
        && data.type === WEB_FOCUS_PONG
        && data.requestId === requestId
    ) {
      acknowledged = true;
    }
  };

  window.addEventListener("message", receivePong);

  try {
    candidate.postMessage(
      {
        source: "rpgyw-foundry",
        type: WEB_FOCUS_PING,
        requestId,
      },
      "*",
    );
  } catch {
    // Navigation below is the fallback.
  }

  await new Promise(
    (resolve) => window.setTimeout(resolve, FOCUS_WAIT_MS),
  );

  window.removeEventListener("message", receivePong);

  if (!acknowledged) {
    try {
      candidate.location.href = url;
    } catch {
      window.open(url, WEB_WINDOW_NAME);
      return;
    }
  }

  try {
    candidate.focus();
  } catch {
    // Browser focus is best-effort.
  }
}
