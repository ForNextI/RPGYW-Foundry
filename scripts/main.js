import {
  initializeChatCommands,
} from "./chat-commands.js";
import {
  claimController,
  getControllerStatus,
  initializeController,
  releaseController,
} from "./controller.js";
import {
  initializeIntegrationService,
} from "./integration-service.js";
import {
  MODULE_ID,
  registerSettings,
} from "./settings.js";
import {
  ensureIntegratorWorldId,
} from "./world-id.js";

Hooks.once("init", () => {
  registerSettings();
  console.log(`${MODULE_ID} | init`);
});

Hooks.once("setup", () => {
  console.log(`${MODULE_ID} | setup`);
});

Hooks.once("ready", async () => {
  await ensureIntegratorWorldId();

  initializeController();
  const integrationService = initializeIntegrationService();
  const chatCommands = initializeChatCommands(integrationService);

  const moduleRecord = game.modules.get(MODULE_ID);
  if (moduleRecord) {
    moduleRecord.api = Object.freeze({
      version: "0.2.1",
      integration: integrationService,
      commands: chatCommands,
      controller: Object.freeze({
        status: getControllerStatus,
        claim: claimController,
        release: releaseController,
      }),
    });
  }

  console.log(`${MODULE_ID} | ready`);
});
