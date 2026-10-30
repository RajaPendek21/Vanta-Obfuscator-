# Obscura engine checkout

The Obscura source is intentionally fetched during local bootstrap or the worker image build rather than duplicated in this repository.

- Run `pnpm bootstrap:obscura` for local development.
- The bootstrap script fetches only the pinned commit recorded in `OBSCURA.lock`.
- `Dockerfile.worker` fetches the same exact commit into `/opt/obscura`.
- Do not update the pin without running the engine smoke test and official Luau compiler validation.

The upstream MIT license and attribution are preserved in `../THIRD_PARTY_LICENSES/`.
