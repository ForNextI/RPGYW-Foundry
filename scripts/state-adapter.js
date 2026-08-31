function finiteNumber(value, label) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    throw new TypeError(`${label} must be a finite number.`);
  }

  return number;
}

function requireCurrentScene() {
  const scene = canvas?.scene;

  if (!scene) {
    throw new Error("Open a Foundry scene before running the RPG Your Way action probe.");
  }

  return scene;
}

function requireSingleControlledToken() {
  const controlled = Array.from(canvas?.tokens?.controlled ?? []);

  if (controlled.length !== 1) {
    throw new Error(
      "Select exactly one token on the current scene before running the RPG Your Way action probe.",
    );
  }

  return controlled[0];
}

export function captureSelectedTokenProbeState() {
  const scene = requireCurrentScene();
  const token = requireSingleControlledToken();
  const document = token.document;

  if (!document?.id) {
    throw new Error("The selected Foundry token is not available.");
  }

  const gridSize = finiteNumber(scene.grid?.size, "scene grid size");

  if (gridSize <= 0) {
    throw new Error("The action probe requires a scene with a positive grid size.");
  }

  return Object.freeze({
    version: 1,
    scene: Object.freeze({
      id: String(scene.id),
      width: finiteNumber(scene.width, "scene width"),
      height: finiteNumber(scene.height, "scene height"),
      gridSize,
    }),
    token: Object.freeze({
      id: String(document.id),
      name: String(document.name || "Selected token").slice(0, 160),
      x: finiteNumber(document.x, "token x"),
      y: finiteNumber(document.y, "token y"),
      width: finiteNumber(document.width, "token width"),
      height: finiteNumber(document.height, "token height"),
      hidden: Boolean(document.hidden),
      disposition: Number.isFinite(Number(document.disposition))
        ? Number(document.disposition)
        : 0,
    }),
  });
}
