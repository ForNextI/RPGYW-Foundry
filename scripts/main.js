const MODULE_ID = "rpg-your-way-integrator";

Hooks.once("init", () => {
  console.log(`${MODULE_ID} | init`);
});

Hooks.once("setup", () => {
  console.log(`${MODULE_ID} | setup`);
});

Hooks.once("ready", () => {
  console.log(`${MODULE_ID} | ready`);
});
