import { MODULE_ID, SETTING_KEYS } from "./settings.js";

function chooseInitializerUserId() {
  return game.users
    .filter((user) => user.active && user.isGM && user.id)
    .map((user) => user.id)
    .sort()[0] ?? null;
}

function createUuidV4() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  const bytes = new Uint8Array(16);

  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }

  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));

  return [
    hex.slice(0, 4).join(""),
    hex.slice(4, 6).join(""),
    hex.slice(6, 8).join(""),
    hex.slice(8, 10).join(""),
    hex.slice(10, 16).join(""),
  ].join("-");
}

export async function ensureIntegratorWorldId() {
  const existingWorldId = game.settings.get(
    MODULE_ID,
    SETTING_KEYS.integratorWorldId,
  );

  if (existingWorldId) {
    return existingWorldId;
  }

  const initializerUserId = chooseInitializerUserId();

  if (!initializerUserId || game.user?.id !== initializerUserId) {
    return null;
  }

  const newWorldId = createUuidV4();

  await game.settings.set(
    MODULE_ID,
    SETTING_KEYS.integratorWorldId,
    newWorldId,
  );

  return newWorldId;
}
