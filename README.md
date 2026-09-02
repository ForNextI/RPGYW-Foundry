# RPG Your Way Foundry Integrator

Current release: **2.12.0**

The RPG Your Way Foundry Integrator connects a Foundry VTT world to an RPG Your Way cloud campaign. RPG Your Way remains the text-play surface, AIGM, campaign-memory, character/rules, multiplayer, and billing authority. Foundry provides the visual tabletop when the campaign needs one.

## 2.12.0 D&D 5.5e Modern character hydration

2.12.0 begins the full-character Foundry path for **RPG Your Way D&D 5.5e (2024 rules)** campaigns. It deliberately targets the Foundry D&D5e **Modern** rules version only.

- RPG Your Way sends a bounded structured character-mechanics payload with abilities, saves, skills, movement, HP, AC, currency, resources, spell slots, classes, attacks, equipment, spells, and canonical features.
- The Integrator hydrates the managed Foundry character Actor and copies exact-name SRD 5.2 Items only from the Modern D&D5e compendia (`classes24`, `origins24`, `feats24`, `spells24`, and `equipment24`). It never borrows an unrelated Actor's gameplay record.
- Managed hydration Items are replaced on a new handoff; manually added Foundry Items are preserved. Unmatched RPG Your Way record entries are retained in Integrator diagnostics instead of being silently converted to the wrong mechanic.
- The 48 canonical Ready-to-Play WebP assets ship inside the Integrator. A selected Ready-to-Play asset wins deterministically; imported/custom characters may use a real manual/local/compendium visual before falling back to the RPGYW monogram.
- This is the **outbound hydration foundation**. Broader Foundry-to-RPGYW mechanical reconciliation follows after this lane is proven against real Modern character sheets.

## 2.9.0 tactical combat pass

2.9.0 turns the first 2.8 battlefield handoff into a more complete Foundry combat surface.

- The Integrator creates a Foundry Combat encounter, adds the RPG Your Way-created tokens as Combatants, applies the initiative values already rolled in RPG Your Way, and starts round 1.
- RPG Your Way-created fallback Scenes disable token-dependent Scene vision and use bright global illumination so an empty test World is immediately usable.
- The Integrator makes a bounded, cached, local-only search through installed Foundry module image paths for plausible maps and token art. RPG Your Way narration and character visual tags provide search terms; no installed asset library is uploaded to RPG Your Way or to the AIGM.
- Existing World Actors can still donate artwork only. Their rules data is never adopted by RPG Your Way-managed Actors.
- If no local visual scores well enough, the reliable gray grid and monogram tokens remain the fallback.
- The cross-site navigation controls now use a focus handshake first. If the matching RPG Your Way or Foundry tab is already alive, the button focuses that browsing context instead of navigating and reloading it.

`/aigm ACTION` remains an intentional in-Foundry path for sending a turn to the RPG Your Way AIGM when a player wants to stay on the VTT surface.

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

For release `2.12.0`:

`git tag v2.12.0`

`git push origin v2.12.0`

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
- `/aigm ACTION`

## Authority boundary

RPG Your Way is authoritative for character records, game rules, campaign continuity, AIGM decisions, player identity, multiplayer state, and billing.

Foundry is the visual and tactical tabletop. The Integrator exchanges only tightly scoped structured state and validated commands with RPG Your Way.

Local module assets are searched and selected only inside the user's Foundry session. The Integrator does not upload purchased maps, token artwork, commercial compendia, installed adventures, journals, or other third-party libraries to RPG Your Way or the AIGM.
