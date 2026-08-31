import {
  FOUNDRY_API_PATHS,
} from "./api-client.js";
import {
  executeIntegratorCommand,
} from "./command-executor.js";
import {
  canRunIntegratorActions,
} from "./controller.js";
import {
  captureSelectedTokenProbeState,
} from "./state-adapter.js";

function requireProbeResponse(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("RPG Your Way returned an invalid action-probe response.");
  }

  if (
    value.version !== 1
      || value.kind !== "gm-action-probe"
      || !Array.isArray(value.commands)
      || value.commands.length !== 1
  ) {
    throw new Error("RPG Your Way returned an unsupported action-probe response.");
  }

  return value;
}

export async function runGmActionProbe(service) {
  if (!canRunIntegratorActions()) {
    throw new Error(
      "Only the active RPG Your Way Integrator controller can run the action probe.",
    );
  }

  const runtimeStatus = service.getStatus();

  if (!runtimeStatus.hasSessionGrant) {
    throw new Error(
      "The Integrator controller needs an active RPG Your Way session grant before running the action probe.",
    );
  }

  const state = captureSelectedTokenProbeState();
  const operationId = crypto.randomUUID();

  const response = requireProbeResponse(
    await service.requestAuthenticated(
      FOUNDRY_API_PATHS.turn,
      {
        method: "POST",
        body: {
          version: 1,
          kind: "gm-action-probe",
          operationId,
          state,
        },
      },
    ),
  );

  const result = await executeIntegratorCommand(
    response.commands[0],
    { explicitProbe: true },
  );

  await service.requestAuthenticated(
    FOUNDRY_API_PATHS.commandResult,
    {
      method: "POST",
      body: result,
    },
  );

  return Object.freeze({
    tokenName: state.token.name,
    result,
  });
}
