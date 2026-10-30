# Deploy Vanta on Render

This repository includes a Render Blueprint that creates the API, isolated build worker, web dashboard, Discord bot, PostgreSQL database, and private Redis-compatible queue. The API and dashboard use the same public web origin; the dashboard's Nginx proxy forwards `/api/*` to the API over Render's private network.

## Before you start

- A GitHub account with this repository pushed to a private or public repository.
- A Render account.
- An email address you control for the first Vanta administrator.
- Discord application credentials if you want the Discord bot and account linking enabled.
- The Render `starter` services and managed database/Key Value resources are paid resources. Check current pricing in Render before confirming creation.

## 1. Put the project on GitHub

1. Download and extract the Vanta ZIP.
2. Create a new GitHub repository named `vanta-obfuscator`.
3. Upload the **contents** of the extracted `vanta-obfuscator` folder to the repository root. `render.yaml`, `Dockerfile`, `Dockerfile.worker`, and `Dockerfile.web` must be at the root.
4. Confirm the repository contains `render.yaml` before continuing.

Do not upload `.env` files, passwords, Discord tokens, or API keys. Only `.env.example` belongs in Git.

## 2. Create the full Render stack

1. Sign in to Render.
2. Open **New** and choose **Blueprint**.
3. Connect GitHub and select `vanta-obfuscator`.
4. Render detects `render.yaml` and lists the services and data stores it will create.
5. Review the region (Frankfurt), service sizes, and current charges.
6. When prompted for `BOOTSTRAP_ADMIN_EMAIL`, enter the email you will use for the first Vanta account.
7. Enter your Discord application **Client ID**, **Client Secret**, and **Bot Token** when prompted. Create the Discord application first if you want the bot deployed in this same step. The optional Guild ID can be left blank; global slash commands are used instead.
8. Confirm creation and wait for the API, worker, web, database, Redis, and bot resources to finish deploying.

The worker image builds the pinned Obscura revision and the official Luau compiler. The first build can take several minutes. Do not use a web-only deploy: the API, worker, database, and Redis are required for builds to work.

## 3. Open Vanta and create the administrator account

1. In Render, open the `vanta-web` service and copy its public `onrender.com` URL.
2. Open that URL. The dashboard should load and the API health indicator should report connected.
3. Choose **Create account**.
4. Register using the exact email entered as `BOOTSTRAP_ADMIN_EMAIL`. In invite-only mode this first configured email receives the administrator role without an invitation.
5. Sign in. Open **Settings** and create an invitation if you want other users to register.
6. Paste a small Luau script into the editor and click **Obfuscate Luau**. Confirm that a completed build returns output. Test the output in Roblox Studio before using it in a live experience.

## 4. Configure Discord OAuth

1. In the Discord Developer Portal, create or open your Vanta application.
2. Add an OAuth2 redirect URL matching the API service's public URL exactly:

   `https://YOUR-VANTA-API.onrender.com/api/discord/oauth/callback`

3. In Render, open `vanta-api` → **Environment** and set `DISCORD_CLIENT_ID` and `DISCORD_CLIENT_SECRET`.
4. Save and redeploy the API.
5. In the Vanta dashboard, open **Discord bot** and select **Link Discord account**.
6. Authorize the Discord account.

The API computes the callback URL from Render's `RENDER_EXTERNAL_HOSTNAME` when `DISCORD_REDIRECT_URI` is not explicitly set. If you use a custom domain, set `DISCORD_REDIRECT_URI` explicitly to the custom API domain's callback URL and add the same URL in the Discord Developer Portal.

## 5. Configure the Discord bot

1. In the Discord Developer Portal, create a bot for the Vanta application and copy its bot token.
2. Invite it to your Discord server with the `bot` and `applications.commands` scopes. Grant only the permissions it needs to respond to slash commands.
3. In Render, open `vanta-discord-bot` → **Environment** and set `DISCORD_TOKEN`. The Client ID is shared from the API service. `DISCORD_GUILD_ID` is optional; if omitted, commands are registered globally and may take longer to appear.
4. In Vanta, sign in as the administrator and open **API keys**. Create a key named `Vanta Discord bot` and copy it immediately.
5. Add `VANTA_BOT_API_KEY` in the bot service's Environment page. Save and redeploy the bot.
6. Test `/status`, `/help`, `/obfuscate`, `/profile`, and `/stats`. `/stats` requires a Discord server administrator; `/profile` and `/stats` also require the bot API key to be configured.

Treat the bot API key like a password. If it is exposed, revoke it in Vanta and create a replacement.

## 6. Verify the deployment

- Open `https://YOUR-VANTA-API.onrender.com/api/health`; it should return HTTP 200 with database and queue ready.
- Open the dashboard and verify the API status is connected.
- Register the administrator account and sign in.
- Run a small Luau build and confirm output is returned.
- Open Build history and confirm the completed build is listed.
- Create an API key, copy it, and revoke it after testing if it is not needed.
- If enabled, test Discord account linking and bot commands.

## 7. Operations and safety

- Keep PostgreSQL and Redis private; the Blueprint does not expose Redis publicly.
- Keep all secrets in Render Environment settings, never in GitHub.
- Back up PostgreSQL regularly and test restoring a backup before relying on the service.
- Monitor Render deploy logs for API, worker, and bot errors.
- The build worker is a separate restricted container with no outbound network at runtime, but container isolation is not a substitute for a formal security review.
- Obscura supports a subset of Luau syntax. A failed build is reported as failed; Vanta does not silently return the original unprotected source.
- Obfuscation does not make client-side secrets safe. Never put credentials, private keys, or authoritative game logic in client code.
- The VM output may be larger and slower than the original. Test in Roblox Studio and profile performance before release.
- If you change the Obscura pin, retain its MIT license and attribution in `THIRD_PARTY_LICENSES/`.
