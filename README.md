# RPG Your Way Foundry Integrator

Current development version: **0.2.0**

The RPG Your Way Foundry Integrator connects a Foundry VTT world to an RPG Your Way cloud campaign. Foundry remains the visual tabletop. RPG Your Way remains the AIGM, campaign-memory, character/rules, and billing authority.

## 0.2.0 test workflow

1. Install or update the Integrator in Foundry and enable it in the World.
2. Open the World as a Foundry GM.
3. In Foundry chat, type:

   `/rpgyw connect`

4. The Integrator posts a private connection card containing a short code and an RPG Your Way approval link.
5. Open the link, sign in to RPG Your Way if necessary, choose the cloud campaign, and approve.
6. Return to Foundry. Within a few seconds the Integrator should report that the world is connected.
7. Type `/rpgyw status` to verify the connection.

This is the first live handshake milestone. 0.2.0 does **not** yet hand Foundry gameplay operations to the AIGM.

## Test commands

- `/rpgyw connect`
- `/rpgyw status`
- `/rpgyw reset`
- `/rpgyw help`

## Authority boundary

RPG Your Way is authoritative for character records, inventory, weapons, class abilities, game rules, campaign continuity, and AIGM decisions.

Foundry is initially authoritative for the local visual tabletop state that it renders: scenes, token placement, player permissions, and other VTT presentation state. Later 0.2.x work will add tightly scoped synchronization and validated AIGM commands.

The Integrator is not designed to upload a user's purchased Foundry maps, token artwork, commercial compendia, installed adventures, or other third-party content to the AIGM.
