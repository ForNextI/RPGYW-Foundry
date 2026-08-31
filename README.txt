RPG Your Way Foundry Integrator 0.2.2 complete-sync hotfix

Why: the local Foundry installation can become a mixed build when the 0.2.1 three-file slash-command hotfix is applied over the older 0.1.9 module. That produces `service.getConnection is not a function` after pairing.

Replace ALL five matching files in the local Foundry module and in the repository:
  module.json
  scripts/main.js
  scripts/chat-commands.js
  scripts/api-client.js
  scripts/integration-service.js

This build uses https://www.rpgyourway.com as the API origin and includes the connection lookup methods required after pairing.
