# Addons catalog extension

Registers the addons of the addons catalog, so they can be added to agent workspaces.

The catalog is loaded once after the extension is activated, from the URL in the `addons.catalog.url` setting (default `https://addons.openkaiden.ai/api/addons.json`). Changes to the setting take effect after a restart.

## Catalog format

```json
{
  "addons": [
    {
      "name": "git",
      "displayName": "Git",
      "publisher": { "name": "kaiden", "displayName": "Kaiden" },
      "image": "ghcr.io/openkaiden/openshell-build-image-addons-git@sha256:…",
      "description": "Statically linked Git",
      "category": "devtools",
      "version": "2.56.1",
      "icon": "icons/git.svg"
    }
  ]
}
```

- Each addon is registered with the id `<publisher.name>.<name>` (e.g. `kaiden.git`).
- `description`, `category`, `version` and `icon` are optional. `icon` is a path or `{ "light": …, "dark": … }`, relative to the catalog URL.
- Icons must be served from the catalog origin, without redirect, as svg or png up to 1 MB.
- Invalid entries and icons that can't be loaded are logged and skipped. The other addons are still registered.
