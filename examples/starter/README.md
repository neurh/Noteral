# Starter plugin

A minimal Noteral plugin that demonstrates the public SDK: a status item, an
inspector panel, and a command. Copy this folder, change the `id`, `name`, and contributions in
`plugin.json`, then run:

```sh
node scripts/build-plugins.mjs
cd examples/starter && zip -r starter.noteral-plugin.zip plugin.json plugin.js
```

Install the zip from **Settings → Plugins → Install local bundle**. The plugin
starts disabled so you can review its permissions first.

Plugins run in a sandboxed iframe. They cannot access Wails, the filesystem, or
the host DOM directly; every call goes through the permission-checked SDK.
