import { initializeController } from "./controller.js";
import { initializeIntegrationService } from "./integration-service.js";
import { MODULE_ID, registerSettings } from "./settings.js";
import { ensureIntegratorWorldId } from "./world-id.js";

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
  initializeIntegrationService();
  console.log(`${MODULE_ID} | ready`);
});
