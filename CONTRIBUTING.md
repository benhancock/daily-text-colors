# Contributing

Thanks for helping improve Daymark.

## Development setup

```bash
npm install
npm test
npm run build
npm run lint
```

The plugin is written in TypeScript and bundled to `main.js` with esbuild.

## Pull requests

- Keep Markdown files unchanged at runtime; annotation history belongs in plugin metadata.
- Add or update tests for range, reconciliation, palette, or task-completion behavior.
- Verify light and dark themes when changing colors or settings UI.
- Run `npm test`, `npm run build`, and `npm run lint` before opening a pull request.

## Reporting bugs

When possible, include:

- Obsidian version and platform.
- Daymark version.
- Whether the issue happens in Live Preview, Reading view, or both.
- A small Markdown example that reproduces the behavior.
