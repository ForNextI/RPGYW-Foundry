import {
  claimController,
  getControllerStatus,
} from "./controller.js";
import {
  MODULE_ID,
  SETTING_KEYS,
} from "./settings.js";

const COMMAND = "/rpgyw";
const COMMAND_KEY = "rpgyw";

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

async function showPairingCard(pairing) {
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

async function announceConnected(service) {
  const connection = await service.getConnection();

  await game.settings.set(
    MODULE_ID,
    SETTING_KEYS.integratorEnabled,
    true,
  );

  await game.settings.set(
    MODULE_ID,
    SETTING_KEYS.linkedRpgYourWayReference,
    connection.campaignId,
  );

  notifyInfo(`Connected to RPG Your Way: ${connection.campaignName}`);

  await privateMessage(`
    <div class="rpg-your-way-connected">
      <h3>RPG Your Way connected</h3>
      <p><strong>${escapeHtml(connection.worldLabel)}</strong> is linked to <strong>${escapeHtml(connection.campaignName)}</strong>.</p>
      <p>Integrator 0.2.2 has completed the first live handshake. Gameplay state and AIGM commands come in later 0.2.x steps.</p>
    </div>
  `);

  return connection;
}

async function connect(service) {
  if (!game.user?.isGM) {
    throw new Error("Only a Foundry GM can connect the world to RPG Your Way.");
  }

  await ensureLocalController();

  const pairing = await service.beginPairing();
  await showPairingCard(pairing);
  notifyInfo(`RPG Your Way connection code: ${pairing.userCode}`);
}

async function status(service) {
  const current = service.getStatus();

  if (current.paired) {
    const connection = await service.getConnection();
    await privateMessage(`
      <div class="rpg-your-way-status">
        <h3>RPG Your Way status</h3>
        <p><strong>Connected</strong> to ${escapeHtml(connection.campaignName)}.</p>
        <p>Foundry world: ${escapeHtml(connection.worldLabel)}</p>
        <p>Campaign revision: ${escapeHtml(connection.campaignRevision)}</p>
      </div>
    `);
    return;
  }

  if (current.pairing.state === "awaiting-approval") {
    await showPairingCard(current.pairing);
    return;
  }

  await privateMessage(`
    <div class="rpg-your-way-status">
      <h3>RPG Your Way status</h3>
      <p>Not currently connected. Type <strong>/rpgyw connect</strong> to begin.</p>
    </div>
  `);
}

async function reset(service) {
  service.resetPairing();

  await game.settings.set(
    MODULE_ID,
    SETTING_KEYS.integratorEnabled,
    false,
  );

  await game.settings.set(
    MODULE_ID,
    SETTING_KEYS.linkedRpgYourWayReference,
    "",
  );

  await privateMessage(`
    <div class="rpg-your-way-status">
      <h3>RPG Your Way local connection reset</h3>
      <p>This browser has discarded its current RPG Your Way session grant. Type <strong>/rpgyw connect</strong> to pair again.</p>
    </div>
  `);
}

async function help() {
  await privateMessage(`
    <div class="rpg-your-way-help">
      <h3>RPG Your Way Foundry Integrator 0.2.2</h3>
      <p><strong>/rpgyw connect</strong> — connect this Foundry world to an RPG Your Way campaign.</p>
      <p><strong>/rpgyw status</strong> — show the current connection.</p>
      <p><strong>/rpgyw reset</strong> — discard this browser's current connection grant.</p>
      <p><strong>/rpgyw help</strong> — show these commands.</p>
    </div>
  `);
}

async function runSubcommand(service, rawSubcommand = "help") {
  const subcommand = String(rawSubcommand || "help")
    .trim()
    .split(/\s+/, 1)[0]
    .toLowerCase();

  if (subcommand === "connect") {
    await connect(service);
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

  console.log(`${MODULE_ID} | registered ${COMMAND} chat command`);
}

export function initializeChatCommands(service) {
  let announcedPairedState = false;

  service.subscribe((current) => {
    if (current.paired && !announcedPairedState) {
      announcedPairedState = true;
      void announceConnected(service).catch(notifyError);
    } else if (!current.paired) {
      announcedPairedState = false;
    }
  });

  registerFoundryChatCommand(service);

  return Object.freeze({
    connect: () => connect(service),
    status: () => status(service),
    reset: () => reset(service),
    help,
  });
}
