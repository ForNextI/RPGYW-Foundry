# RPG Your Way Foundry Integrator

Current release: **2.7.0**

The RPG Your Way Foundry Integrator connects a Foundry VTT world to an RPG Your Way cloud campaign. RPG Your Way remains the text-play surface, AIGM, campaign-memory, character/rules, multiplayer, and billing authority. Foundry provides the visual tabletop when the campaign needs one.

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

For release `2.7.0`:

`git tag v2.7.0`

`git push origin v2.7.0`

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
- `/aigm ACTION` (development test path, not the intended final gameplay interface)

## Authority boundary

RPG Your Way is authoritative for character records, game rules, campaign continuity, AIGM decisions, player identity, multiplayer state, and billing.

Foundry is the visual and tactical tabletop. The Integrator exchanges only tightly scoped structured state and validated commands with RPG Your Way.

The Integrator is not designed to upload a user's purchased Foundry maps, token artwork, commercial compendia, installed adventures, or other third-party content to the AIGM. Local Foundry assets may later be resolved locally for visual use without transferring those libraries to RPG Your Way.
