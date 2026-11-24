# Noteral starter plugin

A minimal plugin to copy: one dynamic command, one status item, and one sidebar panel with a button. It uses SDK 2.0 (`class … extends Plugin`).

```
manifest.json                  id, version, permissions, contributions
src/main.ts                    the plugin
src/noteral.ts                 maps the runtime SDK (window.Noteral); keep as-is
.github/workflows/release.yml  tag → GitHub Release with manifest.json + main.js
```

## Build and try it

```sh
npx esbuild src/main.ts --bundle --format=iife --outfile=main.js
zip starter.zip manifest.json main.js
```

In Noteral, open **Plugins** (puzzle icon) → **Install from file**, then pick `starter.zip`. Review the permissions and approve. To try a change, rebuild and install the zip again. The plugin keeps its id, so its saved data stays.

## Types

`src/noteral.ts` imports only types from `@noteral/sdk`, so the build works without the SDK installed. For editor types, check out the Noteral repo next to yours and add:

```json
{ "compilerOptions": { "strict": true, "target": "ES2022", "module": "ESNext", "moduleResolution": "Bundler",
  "lib": ["ES2022", "DOM"], "noEmit": true,
  "paths": { "@noteral/sdk": ["../Noteral/sdk/src/index.ts"] } } }
```

## Publish

1. Set `id` (reverse-domain, final), `name`, `author` and `repo` (`owner/name`) in `manifest.json`.
2. Push a tag equal to `version`: `git tag 0.1.0 && git push origin 0.1.0`. The workflow builds and publishes the release.
3. Open a PR that adds your entry to `registry/community-plugins.json` in the Noteral repo.

Full guides: `docs/plugins/README.md`, `docs/plugins/manifest.md`, `docs/plugins/publishing.md`. API reference: `docs/sdk/api-reference.md`.
