export const MODULE_ID = "rpg-your-way-integrator";

export const SETTING_KEYS = Object.freeze({
  integratorEnabled: "integratorEnabled",
  integratorWorldId: "integratorWorldId",
  controllerUserId: "controllerUserId",
  supportedAdapter: "supportedAdapter",
  assetSelectionMode: "assetSelectionMode",
  allowAIGMSceneChanges: "allowAIGMSceneChanges",
  allowAIGMTokenMovement: "allowAIGMTokenMovement",
  allowAIGMCombatAutomation: "allowAIGMCombatAutomation",
  linkedRpgYourWayReference: "linkedRpgYourWayReference",
  defaultCharacterActorId: "defaultCharacterActorId",
  showIntegratorNotifications: "showIntegratorNotifications",
});

function registerWorldSetting(key, type, defaultValue) {
  game.settings.register(MODULE_ID, key, {
    scope: "world",
    config: false,
    type,
    default: defaultValue,
  });
}

function registerUserSetting(key, type, defaultValue) {
  game.settings.register(MODULE_ID, key, {
    scope: "user",
    config: false,
    type,
    default: defaultValue,
  });
}

export function registerSettings() {
  registerWorldSetting(SETTING_KEYS.integratorEnabled, Boolean, false);
  registerWorldSetting(SETTING_KEYS.integratorWorldId, String, "");
  registerWorldSetting(SETTING_KEYS.controllerUserId, String, "");
  registerWorldSetting(SETTING_KEYS.supportedAdapter, String, "dnd5e");
  registerWorldSetting(SETTING_KEYS.assetSelectionMode, String, "eligible-only");

  registerWorldSetting(SETTING_KEYS.allowAIGMSceneChanges, Boolean, false);
  registerWorldSetting(SETTING_KEYS.allowAIGMTokenMovement, Boolean, false);
  registerWorldSetting(SETTING_KEYS.allowAIGMCombatAutomation, Boolean, false);

  registerUserSetting(SETTING_KEYS.linkedRpgYourWayReference, String, "");
  registerUserSetting(SETTING_KEYS.defaultCharacterActorId, String, "");
  registerUserSetting(SETTING_KEYS.showIntegratorNotifications, Boolean, true);
}
