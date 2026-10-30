# Obscura attribution and integration notice

Vanta integrates the upstream [vo3pal/obscura](https://github.com/vo3pal/obscura) Luau obfuscator under its MIT license.

- Pinned upstream commit: `742770554151d82c6a12ae6e24a0e47471bc467c`
- Runtime entry point: `packages/engine/python/obscura_adapter.py`
- Vanta selects Obscura's `PARANOID` configuration, which invokes Obscura's own VM compilation and generated runtime.
- The upstream source is fetched at the pinned commit by the worker Docker build, or by `pnpm bootstrap:obscura` for local development.
- The full upstream MIT license text is preserved in `OBSCURA-MIT.txt`.

This integration is intentionally replaceable: Vanta's TypeScript worker calls a small stdin/stdout adapter rather than depending directly on Obscura's internal Python modules. That boundary makes it possible to update, replace, or extend the engine later.
