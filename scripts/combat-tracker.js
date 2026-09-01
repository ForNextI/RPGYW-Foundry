import {
  MODULE_ID,
} from "./settings.js";

const MANAGED_COMBAT_FLAG = "managedCombat";
const SOURCE_ENCOUNTER_FLAG = "sourceEncounterId";

function finiteInitiative(value) {
  return (
    typeof value === "number"
      && Number.isFinite(value)
  )
    ? value
    : null;
}

function combatClass() {
  return globalThis.Combat
    ?? globalThis.foundry?.documents?.Combat
    ?? null;
}

function tokenDocumentClass() {
  return globalThis.TokenDocument
    ?? globalThis.foundry?.documents?.TokenDocument
    ?? null;
}

async function deletePreviousManagedCombats() {
  const combats = game.combats?.contents?.filter(
    (combat) => combat.getFlag(
      MODULE_ID,
      MANAGED_COMBAT_FLAG,
    ) === true,
  ) ?? [];

  for (const combat of combats) {
    await combat.delete();
  }
}

export async function createManagedCombat({
  scene,
  encounterId,
  placements,
}) {
  if (!scene?.id) {
    throw new Error(
      "A Foundry Scene is required to create RPG Your Way combat.",
    );
  }

  const CombatClass = combatClass();
  const TokenDocumentClass = tokenDocumentClass();

  if (
    !CombatClass?.create
      || typeof TokenDocumentClass?.createCombatants !== "function"
  ) {
    throw new Error(
      "Foundry V14 Combat APIs are unavailable.",
    );
  }

  await deletePreviousManagedCombats();

  const combat = await CombatClass.create({
    scene: scene.id,
    active: true,
    round: 0,
    turn: null,
    flags: {
      [MODULE_ID]: {
        [MANAGED_COMBAT_FLAG]: true,
        [SOURCE_ENCOUNTER_FLAG]: encounterId,
      },
    },
  });

  if (!combat) {
    throw new Error(
      "Foundry could not create the RPG Your Way Combat encounter.",
    );
  }

  const tokens = placements
    .map((placement) => placement.token)
    .filter(Boolean);

  await TokenDocumentClass.createCombatants(
    tokens,
    { combat },
  );

  const combatants = Array.from(combat.combatants ?? []);
  const updates = [];

  for (const placement of placements) {
    const initiative = finiteInitiative(
      placement.initiative,
    );

    if (initiative === null) {
      continue;
    }

    const combatant = combatants.find(
      (candidate) => candidate.tokenId === placement.token?.id,
    );

    if (combatant?.id) {
      updates.push({
        _id: combatant.id,
        initiative,
      });
    }
  }

  if (updates.length > 0) {
    await combat.updateEmbeddedDocuments(
      "Combatant",
      updates,
    );
  }

  await combat.activate();

  // Round 0 is the pre-combat setup phase. Players may position their own
  // characters before the normal Foundry Begin Combat control starts round 1.
  return combat;
}
