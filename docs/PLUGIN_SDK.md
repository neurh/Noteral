# Noteral Plugin SDK

This page moved. The SDK is now version **2.0** (SDK 1.x plugins still load):

- [Plugin guide](plugins/README.md): quick start, the `Plugin` class, events, permissions, styling, debugging
- [manifest.json reference](plugins/manifest.md)
- [Publishing to the community store](plugins/publishing.md)
- [API reference](sdk/api-reference.md): every method, generated from `frontend/src/sdk-host/spec.ts`
- [Assistant](assistant.md): AI chat modes and how it uses the same API
- For AI agents: [llms.txt](sdk/llms.txt) / [llms-full.txt](sdk/llms-full.txt)

## Keeping the public hub in sync

The SDK, these docs, the CLI, the examples and the registry bot are published to
[neurh/noteral-plugins](https://github.com/neurh/noteral-plugins), exported from this repo.
Any change to the SDK (`frontend/src/sdk-host/spec.ts`, `types.ts`), `sdk/`, `docs/sdk`,
`docs/plugins`, `docs/assistant.md`, `examples/`, the registry scripts or the plugin
permissions in `internal/plugins/plugins.go` must also update the hub:

1. `node scripts/build-sdk.mjs`
2. `npm run hub:export` (exports into `../noteral-plugins`)
3. In the hub: `node registry/validate.mjs` and `node --test registry/registry.test.mjs`
4. Commit and push the hub.

`npm run hub:check` lists what the hub is missing without changing it.
