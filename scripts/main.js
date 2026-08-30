import { MODULE_ID, registerSettings } from "./settings.js";

Hooks.once("init", () => {
  registerSettings();
  console.log(`${MODULE_ID} | init`);
});

Hooks.once("setup", () => {
  console.log(`${MODULE_ID} | setup`);
});

Hooks.once("ready", () => {
  console.log(`${MODULE_ID} | ready`);
});
