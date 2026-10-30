# Vanta release status

## Included in this source package

- React dashboard with the single **Obfuscate Luau** action.
- Account registration/login, invite-only registration mode, administrator bootstrap, sessions, API keys, and revocation.
- PostgreSQL schema and build history/output persistence.
- Redis/BullMQ queue and a separate non-root worker container.
- Pinned MIT-licensed Obscura PARANOID VM pipeline, with upstream attribution retained.
- Official Luau compiler validation before and after transformation.
- Discord OAuth account linking and slash-command bot (`/help`, `/status`, `/profile`, `/stats`, `/obfuscate`).
- Docker Compose stack and Render Blueprint for the web, API, worker, bot, PostgreSQL, and private Redis-compatible Key Value service.
- Step-by-step Render deployment instructions.

## Verification performed for this package

- Render Blueprint and Docker Compose files parse as YAML.
- Python adapter syntax check passed.
- Obscura bootstrap shell syntax check passed.
- Official Luau parser test script JavaScript syntax check passed.

## Verification not completed in this environment

- TypeScript typecheck and package builds: blocked because pnpm/dependencies are not installed and package registry access is unavailable here.
- Docker image builds and Compose startup: Docker is unavailable in this environment.
- Obscura VM execution and official compiler integration: requires the pinned upstream source, Python dependencies, and the Luau compiler to be fetched/built.
- Live Render deployment, Discord OAuth/bot test, and Roblox Studio runtime test: require the owner's external accounts and credentials.

This is a deployable source package with deployment configuration, not a claim that a live production deployment has already been created or independently security-audited. Do not treat the VM as a guarantee that source behavior or constants cannot be recovered. Test every protected script in Roblox Studio before release.
