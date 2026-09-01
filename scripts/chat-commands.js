import {
  claimController,
  getControllerStatus,
} from "./controller.js";
import {
  MODULE_ID,
  SETTING_KEYS,
} from "./settings.js";
import {
  runGmActionProbe,
} from "./gm-action-probe.js";
import {
  mapSelectedActorToCharacter,
  refreshFoundryRoster,
  unmapCharacter,
} from "./mapping-service.js";
import {
  sendAigmTurn,
} from "./aigm-turn.js";

const COMMAND = "/rpgyw";
const COMMAND_KEY = "rpgyw";
const AIGM_COMMAND = "/aigm";
const AIGM_COMMAND_KEY = "aigm";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function privateMessage(content) {
  return ChatMessage.create({
    speaker: {
      alias: "RPG Your Way",
    },
    content,
    whisper: [game.user.id],
  });
}

function richText(value) {
  const text = escapeHtml(value).trim();
  if (!text) return "<p></p>";

  return text
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${paragraph.replaceAll("\n", "<br>")}</p>`)
    .join("");
}

async function publicMessage(alias, content) {
  return ChatMessage.create({
    speaker: {
      alias: String(alias || "RPG Your Way"),
    },
    content: richText(content),
  });
}

function notifyInfo(message) {
  if (game.settings.get(MODULE_ID, SETTING_KEYS.showIntegratorNotifications)) {
    ui.notifications.info(message);
  }
}

function notifyError(error) {
  const message = (
    error?.body?.error
      || error?.message
      || "RPG Your Way Foundry Integrator encountered an error."
  );

  ui.notifications.error(message);
  console.error(`${MODULE_ID} |`, error);
}

function worldIsConnected() {
  return Boolean(
    game.settings.get(
      MODULE_ID,
      SETTING_KEYS.integratorEnabled,
    ),
  );
}

function linkedCampaignName() {
  return game.settings.get(
    MODULE_ID,
    SETTING_KEYS.linkedCampaignName,
  ) || "";
}

function linkedPlayerReference() {
  return game.settings.get(
    MODULE_ID,
    SETTING_KEYS.linkedPlayerReference,
  ) || "";
}

async function ensureLocalController() {
  const status = getControllerStatus();

  if (status.state === "unassigned") {
    await claimController();
    return;
  }

  if (status.state === "local-controller") {
    return;
  }

  throw new Error(
    "Another Foundry GM is configured as Integrator controller.",
  );
}

async function showWorldPairingCard(pairing) {
  const code = escapeHtml(pairing.userCode);
  const url = escapeHtml(pairing.verificationUrl);

  await privateMessage(`
    <div class="rpg-your-way-pairing">
      <h3>Connect RPG Your Way</h3>
      <p>Your one-time connection code is <strong>${code}</strong>.</p>
      <p><a href="${url}" target="_blank" rel="noopener noreferrer">Open RPG Your Way and approve this Foundry world</a></p>
      <p>This code expires shortly. The approval page will ask which cloud campaign this Foundry world should represent.</p>
    </div>
  `);
}

async function showPlayerLinkCard(pairing) {
  const code = escapeHtml(pairing.userCode);
  const url = escapeHtml(pairing.verificationUrl);

  await privateMessage(`
    <div class="rpg-your-way-pairing">
      <h3>Link your RPG Your Way account</h3>
      <p>Your one-time player-link code is <strong>${code}</strong>.</p>
      <p><a href="${url}" target="_blank" rel="noopener noreferrer">Open RPG Your Way and approve this Foundry player</a></p>
      <p>This links your Foundry user to your RPG Your Way account. It does not give you GM or controller authority.</p>
    </div>
  `);
}

async function announceConnected(service) {
  const connection = await service.getConnection();

  await game.settings.set(
    MODULE_ID,
    SETTING_KEYS.integratorEnabled,
    true,
  );

  await game.settings.set(
    MODULE_ID,
    SETTING_KEYS.linkedCampaignReference,
    connection.campaignId,
  );

  await game.settings.set(
    MODULE_ID,
    SETTING_KEYS.linkedCampaignName,
    connection.campaignName,
  );

  notifyInfo(`Connected to RPG Your Way: ${connection.campaignName}`);

  await privateMessage(`
    <div class="rpg-your-way-connected">
      <h3>RPG Your Way connected</h3>
      <p><strong>${escapeHtml(connection.worldLabel)}</strong> is linked to <strong>${escapeHtml(connection.campaignName)}</strong>.</p>
      <p>The world connection belongs to the Integrator controller. Individual players link their own accounts separately.</p>
    </div>
  `);

  return connection;
}

async function announcePlayerLinked(service) {
  const playerLink = await service.getPlayerLink();

  await game.settings.set(
    MODULE_ID,
    SETTING_KEYS.linkedPlayerReference,
    playerLink.linkId,
  );

  notifyInfo(`RPG Your Way account linked: ${playerLink.campaignName}`);

  await privateMessage(`
    <div class="rpg-your-way-connected">
      <h3>RPG Your Way player linked</h3>
      <p><strong>${escapeHtml(playerLink.foundryUserName)}</strong> is linked to your RPG Your Way account for <strong>${escapeHtml(playerLink.campaignName)}</strong>.</p>
      <p>This player link is separate from Foundry GM/controller authority and from character ownership.</p>
    </div>
  `);

  return playerLink;
}

async function linkPlayer(service) {
  if (!worldIsConnected()) {
    throw new Error(
      "This Foundry world must be connected to RPG Your Way before players can link accounts.",
    );
  }

  const pairing = await service.beginPlayerLink();
  await showPlayerLinkCard(pairing);
  notifyInfo(`RPG Your Way player-link code: ${pairing.userCode}`);
}

async function connect(service) {
  if (!game.user?.isGM) {
    await linkPlayer(service);
    return;
  }

  await ensureLocalController();

  const pairing = await service.beginPairing();
  await showWorldPairingCard(pairing);
  notifyInfo(`RPG Your Way connection code: ${pairing.userCode}`);
}

async function status(service) {
  const current = service.getStatus();
  const worldConnected = worldIsConnected();
  let campaignName = linkedCampaignName();
  let playerLink = null;

  if (current.playerLink.paired) {
    playerLink = await service.getPlayerLink();
    campaignName = campaignName || playerLink.campaignName;
  }

  const worldStatus = worldConnected
    ? (
      campaignName
        ? `Connected to <strong>${escapeHtml(campaignName)}</strong>.`
        : "Connected."
    )
    : "Not connected.";

  let accountStatus = "Not linked.";

  if (current.playerLink.pairing.state === "awaiting-approval") {
    accountStatus = "Waiting for approval.";
  } else if (current.playerLink.paired && playerLink) {
    accountStatus = `Linked to <strong>${escapeHtml(playerLink.campaignName)}</strong> with an active browser session.`;
  } else if (linkedPlayerReference()) {
    accountStatus = "Linked. This browser needs a fresh player session; use <strong>/rpgyw link</strong>.";
  }

  await privateMessage(`
    <div class="rpg-your-way-status">
      <h3>RPG Your Way status</h3>
      <p>World: <strong>${worldStatus}</strong></p>
      <p>Your account: <strong>${accountStatus}</strong></p>
      ${!worldConnected && game.user?.isGM ? '<p>Use <strong>/rpgyw connect</strong> to connect the world.</p>' : ""}
      ${worldConnected && !current.playerLink.paired && !linkedPlayerReference() ? '<p>Use <strong>/rpgyw link</strong> to link this Foundry user to your RPG Your Way account.</p>' : ""}
    </div>
  `);
}

async function reset(service) {
  if (game.user?.isGM) {
    service.resetPairing();

    await game.settings.set(
      MODULE_ID,
      SETTING_KEYS.integratorEnabled,
      false,
    );

    await game.settings.set(
      MODULE_ID,
      SETTING_KEYS.linkedCampaignReference,
      "",
    );

    await game.settings.set(
      MODULE_ID,
      SETTING_KEYS.linkedCampaignName,
      "",
    );

    await privateMessage(`
      <div class="rpg-your-way-status">
        <h3>RPG Your Way local world connection reset</h3>
        <p>This browser discarded its controller session grant and marked the local world connection inactive. Use <strong>/rpgyw connect</strong> to pair again.</p>
      </div>
    `);
    return;
  }

  service.resetPlayerLink();

  await game.settings.set(
    MODULE_ID,
    SETTING_KEYS.linkedPlayerReference,
    "",
  );

  await privateMessage(`
    <div class="rpg-your-way-status">
      <h3>RPG Your Way local player link reset</h3>
      <p>This browser discarded its player session grant. Use <strong>/rpgyw link</strong> to link again.</p>
    </div>
  `);
}

async function probe(service) {
  const probeResult = await runGmActionProbe(service);

  await privateMessage(`
    <div class="rpg-your-way-status">
      <h3>RPG Your Way action probe complete</h3>
      <p><strong>${escapeHtml(probeResult.tokenName)}</strong> moved to <strong>${escapeHtml(probeResult.result.x)}, ${escapeHtml(probeResult.result.y)}</strong>.</p>
      <p>The command came from RPG Your Way and was executed by the active Integrator controller.</p>
    </div>
  `);
}

function rosterCharacterRow(character, index, participantsById) {
  const actor = character.foundryActorId
    ? game.actors.get(character.foundryActorId)
    : null;

  const actorLabel = character.foundryActorId
    ? (
      actor?.name
        ? escapeHtml(actor.name)
        : `Missing Actor ${escapeHtml(character.foundryActorId)}`
    )
    : "Not mapped";

  const controllers = character.controllerParticipantIds.map(
    (participantId) => participantsById.get(participantId),
  ).filter(Boolean);

  const controllerLabel = controllers.length
    ? controllers.map((participant) => {
      const foundryName = participant.foundryUserId
        ? game.users.get(participant.foundryUserId)?.name
        : null;

      return foundryName
        ? `${escapeHtml(participant.displayName)} → ${escapeHtml(foundryName)}`
        : `${escapeHtml(participant.displayName)} → Foundry user not uniquely linked`;
    }).join(", ")
    : "No RPG Your Way player assigned";

  return `
    <li>
      <strong>${index + 1}. ${escapeHtml(character.displayName)}</strong>
      — ${actorLabel}<br>
      <small>${controllerLabel}</small>
    </li>
  `;
}

async function roster(service) {
  const current = await refreshFoundryRoster(service);
  const participantsById = new Map(
    current.participants.map(
      (participant) => [participant.participantId, participant],
    ),
  );

  const rows = current.characters.map(
    (character, index) => (
      rosterCharacterRow(character, index, participantsById)
    ),
  ).join("");

  await privateMessage(`
    <div class="rpg-your-way-status">
      <h3>RPG Your Way character map</h3>
      <ol>${rows}</ol>
      <p>Select one Foundry token, then use <strong>/rpgyw map NUMBER</strong>.</p>
    </div>
  `);

  return current;
}

async function mapCharacter(service, selector) {
  const result = await mapSelectedActorToCharacter(service, selector);

  await privateMessage(`
    <div class="rpg-your-way-status">
      <h3>RPG Your Way character mapped</h3>
      <p><strong>${escapeHtml(result.character?.displayName || selector)}</strong> is mapped to Foundry Actor <strong>${escapeHtml(result.actorName)}</strong>.</p>
    </div>
  `);
}

async function unmap(service, selector) {
  await unmapCharacter(service, selector);

  await privateMessage(`
    <div class="rpg-your-way-status">
      <h3>RPG Your Way character mapping removed</h3>
      <p>The selected RPG Your Way character is no longer mapped to a Foundry Actor.</p>
    </div>
  `);
}

async function help() {
  await privateMessage(`
    <div class="rpg-your-way-help">
      <h3>RPG Your Way Foundry Integrator 2.10.0</h3>
      <p><strong>/aigm ACTION</strong> — send a live campaign turn to the RPG Your Way AIGM while staying in Foundry.</p>
      <p><strong>/rpgyw connect</strong> — GMs connect the world; Players use the same command as a shortcut to player linking.</p>
      <p><strong>/rpgyw link</strong> — link this Foundry user to your RPG Your Way account.</p>
      <p><strong>/rpgyw roster</strong> — show RPG Your Way players, character assignments, and Foundry Actor mappings.</p>
      <p><strong>/rpgyw map NUMBER</strong> — map the selected Foundry token's Actor to a character from the roster.</p>
      <p><strong>/rpgyw unmap NUMBER</strong> — remove one character-to-Actor mapping.</p>
      <p><strong>/rpgyw probe</strong> — with exactly one token selected, run the server-to-Foundry movement probe.</p>
      <p><strong>/rpgyw status</strong> — show world connection and player-account status separately.</p>
      <p><strong>/rpgyw reset</strong> — discard the current browser's applicable local grant.</p>
      <p><strong>/rpgyw help</strong> — show these commands.</p>
    </div>
  `);
}

async function runSubcommand(service, rawSubcommand = "help") {
  const parts = String(rawSubcommand || "help")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const subcommand = (parts.shift() || "help").toLowerCase();
  const argument = parts.join(" ");

  if (subcommand === "connect") {
    await connect(service);
  } else if (subcommand === "link") {
    await linkPlayer(service);
  } else if (subcommand === "roster") {
    await roster(service);
  } else if (subcommand === "map") {
    await mapCharacter(service, argument);
  } else if (subcommand === "unmap") {
    await unmap(service, argument);
  } else if (subcommand === "probe") {
    await probe(service);
  } else if (subcommand === "status") {
    await status(service);
  } else if (subcommand === "reset") {
    await reset(service);
  } else {
    await help();
  }
}

function registerFoundryChatCommand(service) {
  const ChatLog = foundry?.applications?.sidebar?.tabs?.ChatLog;

  if (!ChatLog?.CHAT_COMMANDS) {
    throw new Error("Foundry V14 ChatLog command registry is unavailable.");
  }

  ChatLog.CHAT_COMMANDS[COMMAND_KEY] = {
    rgx: /^\/rpgyw(?:\s+(.*))?$/i,
    fn: async (_command, match) => {
      const rawSubcommand = Array.isArray(match) ? match[1] : "help";

      try {
        await runSubcommand(service, rawSubcommand || "help");
      } catch (error) {
        notifyError(error);
      }

      return false;
    },
  };

  ChatLog.CHAT_COMMANDS[AIGM_COMMAND_KEY] = {
    rgx: /^\/aigm(?:\s+([\s\S]+))?$/i,
    fn: async (_command, match) => {
      const input = Array.isArray(match) ? match[1] : "";

      try {
        const result = await sendAigmTurn(service, input || "");
        await publicMessage(
          result.playerDisplayName || game.user?.name || "Player",
          result.input,
        );
        await publicMessage(
          result.gameMasterName || "RPG Your Way",
          result.message,
        );

        if (result.vttQueued) {
          notifyInfo(
            "RPG Your Way queued a revised VTT setup for the Integrator controller.",
          );
        }
        if (result.vttWarning) {
          ui.notifications.warn(
            `RPG Your Way VTT setup warning: ${result.vttWarning}`,
          );
        }

        if (result.billing?.settlementWarning) {
          ui.notifications.warn(
            `RPG Your Way billing warning: ${result.billing.settlementWarning}`,
          );
        }
      } catch (error) {
        notifyError(error);
      }

      return false;
    },
  };

  console.log(
    `${MODULE_ID} | registered ${COMMAND} and ${AIGM_COMMAND} chat commands`,
  );
}

export function initializeChatCommands(service) {
  let announcedWorldPair = false;
  let announcedPlayerLink = false;

  service.subscribe((current) => {
    if (current.paired && !announcedWorldPair) {
      announcedWorldPair = true;
      void announceConnected(service).catch(notifyError);
    } else if (!current.paired) {
      announcedWorldPair = false;
    }

    if (current.playerLink.paired && !announcedPlayerLink) {
      announcedPlayerLink = true;
      void announcePlayerLinked(service).catch(notifyError);
    } else if (!current.playerLink.paired) {
      announcedPlayerLink = false;
    }
  });

  registerFoundryChatCommand(service);

  return Object.freeze({
    connect: () => connect(service),
    link: () => linkPlayer(service),
    roster: () => roster(service),
    map: (selector) => mapCharacter(service, selector),
    unmap: (selector) => unmap(service, selector),
    probe: () => probe(service),
    status: () => status(service),
    reset: () => reset(service),
    help,
  });
}
