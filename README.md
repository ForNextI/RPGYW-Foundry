# RPG Your Way Foundry Integrator

Current release: **2.8.0**

The RPG Your Way Foundry Integrator connects a Foundry VTT world to an RPG Your Way cloud campaign. RPG Your Way remains the text-play surface, AIGM, campaign-memory, character/rules, multiplayer, and billing authority. Foundry provides the visual tabletop when the campaign needs one.

## 2.8.0 combat handoff

2.8.0 adds the first RPG Your Way → Foundry combat handoff.

When an RPG Your Way combat has party and NPC initiative, the player can choose VTT. The connected Foundry controller receives a compact structured encounter request and prepares a tactical Scene.

The first renderer deliberately favors reliability:

- It creates or reuses RPG Your Way-managed PC Actors rather than borrowing another Actor's class, level, spells, inventory, or other character data.
- A previously mapped local Actor may donate only its token or portrait image.
- PC hit points come from RPG Your Way.
- Token names are always visible and PC hit-point bars appear on hover.
- If no suitable local image exists, a local three-character monogram token is used, such as `FIG`, `WIZ`, `CLE`, or `ROG`.
- A suitable Scene already in the World may donate only its background image and basic grid dimensions. Walls, journals, lights, tokens, and other Scene content are not copied.
- No local artwork, compendium, adventure, journal, or map library is uploaded to the AIGM.

The Foundry **Go to RPG Your Way** control and RPG Your Way **Go to VTT** control are navigation only. They do not start or end combat, advance a turn, change billing, or mutate character state.

## Install from the internet

End users should install the Integrator through Foundry rather than copying this repository into Foundry's data directory.

Stable manifest URL:

`https://github.com/ForNextI/RPGYW-Foundry/releases/latest/download/module.json`

In Foundry Setup:

1. Open **Add-on Modules**.
2. Choose **Install Module**.
3. Paste the stable manifest URL.
4. Install **RPG Your Way Foundry Integrator**.
5. Enable it in the desired World.

Foundry can use the same manifest URL to discover future releases.

## Development and releases

The GitHub repository is development source. A tagged release is the distributable Foundry package.

For release `2.8.0`:

`git tag v2.8.0`

`git push origin v2.8.0`

The GitHub Actions release workflow validates the manifest and JavaScript, builds `rpg-your-way-integrator.zip`, and publishes both the ZIP and `module.json` to the GitHub Release.

## Current test commands

- `/rpgyw connect`
- `/rpgyw link`
- `/rpgyw roster`
- `/rpgyw map NUMBER`
- `/rpgyw unmap NUMBER`
- `/rpgyw probe`
- `/rpgyw status`
- `/rpgyw reset`
- `/rpgyw help`
- `/aigm ACTION` (development test path only; normal gameplay remains on RPG Your Way)

## Authority boundary

RPG Your Way is authoritative for character records, game rules, campaign continuity, AIGM decisions, player identity, multiplayer state, and billing.

Foundry is the visual and tactical tabletop. The Integrator exchanges only tightly scoped structured state and validated commands with RPG Your Way.

The Integrator does not upload a user's purchased Foundry maps, token artwork, commercial compendia, installed adventures, journals, or other third-party content to the AIGM. 2.8.0 may resolve explicitly limited visual fields locally inside the user's own Foundry World.
