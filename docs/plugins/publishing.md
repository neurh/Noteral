# Publishing a plugin

Community plugins are hosted on GitHub. Noteral doesn't run a server:

1. **Your repo** publishes each version as a **GitHub Release** with `manifest.json`, `main.js` and, optionally, `styles.css` attached as release assets.
2. **The registry** is one file, [`registry/community-plugins.json`](../../registry/community-plugins.json), in the Noteral repo. A pull request adds your plugin once. After that, every new release reaches users without another PR.

```
Noteral store ── GET raw.githubusercontent.com/neurh/Noteral/main/registry/community-plugins.json
              ── GET api.github.com/repos/<owner>/<repo>/releases/latest           (notes, tag, date)
              ── GET github.com/<owner>/<repo>/releases/latest/download/manifest.json
              ── GET …/download/main.js, …/download/styles.css                     (on install/update)
```

The store contacts GitHub only when the user opens the **Community** tab or presses **Check for updates**. The registry URL can be changed under *Community → Registry source* (for a private or mirror registry).

## 1. Prepare the repo

```
my-plugin/
├── manifest.json        # "repo": "<owner>/<repo>", "version": "1.0.0"
├── src/main.ts
├── styles.css           # optional
└── .github/workflows/release.yml
```

`manifest.json` must name your repo in `repo`, and its `version` must be the version you're releasing. See [manifest.md](manifest.md).

## 2. Release

Tag the commit with the version and push the tag:

```bash
git tag 1.0.0 && git push origin 1.0.0
```

The workflow in `examples/starter/.github/workflows/release.yml` builds `main.js`, checks that the tag matches `manifest.json`'s version, and creates the release with the assets attached:

```yaml
name: Release
on:
  push:
    tags: ["*"]
permissions:
  contents: write
jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: npx --yes esbuild@0.28.2 src/main.ts --bundle --format=iife --outfile=main.js
      - name: Check version
        run: test "$(node -p "require('./manifest.json').version")" = "${GITHUB_REF_NAME#v}"
      - name: Publish
        env: { GH_TOKEN: "${{ github.token }}" }
        run: |
          files="manifest.json main.js"; [ -f styles.css ] && files="$files styles.css"
          gh release create "$GITHUB_REF_NAME" $files --title "$GITHUB_REF_NAME" --generate-notes
```

To release by hand, create a release in the GitHub UI and upload the same files. Only the **latest** non-draft, non-pre-release release is offered to users. The release notes appear in the update review screen as Markdown.

## 3. Submit to the registry

Open a pull request that adds one entry to `registry/community-plugins.json`:

```json
{
  "id": "com.example.reading-time",
  "name": "Reading Time",
  "author": "Ada Example",
  "description": "Shows how long the open page takes to read.",
  "repo": "ada/noteral-reading-time",
  "tags": ["writing", "status-bar"]
}
```

- `id` must equal the manifest `id`, and `repo` must be the repo that publishes the releases.
- `description` is at most 500 characters and `tags` holds at most 8 entries. Entries are unique by `id`.
- The repo must already have a release with a valid `manifest.json`. The store shows plugins without one as unavailable.

The registry check (`node registry/validate.mjs`) runs on every PR and applies the same rules as the app. A malformed entry is skipped by the app rather than breaking the store, but CI rejects it.

## Updates

- **Check for updates** compares each installed community plugin's version with its repo's latest release.
- An update that **adds permissions** shows them tagged *new* and must be approved again. An update that keeps the same permissions installs after one click.
- Saved data (`saveData`) survives updates. Changing `id` creates a different plugin, so don't.
- Set `minAppVersion` when you start using a newer API. Older apps then show "requires Noteral x.y.z" instead of installing something that fails.

## Testing a release before you publish

- **Install from file** with a zip of `manifest.json` + `main.js` goes through the same validation and permission review as a release.
- To test the whole store flow against a mirror or a local mock, set the registry URL under *Community → Registry source* and start Noteral with `NOTERAL_GITHUB_BASE` (release downloads, default `https://github.com`) and `NOTERAL_GITHUB_API` (release notes, default `https://api.github.com`) pointing at it.

## Review checklist

- [ ] `id` is reverse-domain and final; `version` matches the tag
- [ ] the permission list is minimal, with `network` only if the plugin really talks to a server, and the README explains why it's needed
- [ ] works in light and dark (use CSS tokens, not hard-coded colors)
- [ ] `onunload` cleans up anything not registered through the `Plugin` helpers
- [ ] README with a screenshot, the permissions it asks for, and what data leaves the device (if any)
