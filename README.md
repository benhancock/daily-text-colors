# Daymark

Daymark colors additions made after a note’s creation day while keeping the Markdown source unchanged.

It is designed for chronological annotation: existing note text remains the baseline, and later additions become visually dated without adding inline markers to your files.

## Behavior

- Text written on the creation day stays uncolored.
- Visible prose added on later calendar days receives a date-specific color immediately.
- A configurable color cycle rotates through a note’s distinct annotation dates.
- YAML frontmatter, fenced code, inline code, and Markdown punctuation are not colored.
- Wiki links and external links can keep their native styling or use annotation colors.
- Completed task strikethroughs can optionally be colored by the date the task was checked.
- Annotation history is stored in per-note sidecars under `.daymark/notes/`.
- A compact index beside the plugin bundle keeps startup fast; full note snapshots
  are loaded only when Daymark needs to reconcile an outside edit.
- Notes without annotations are not persisted, avoiding full-vault snapshot growth.

## Storage

Daymark never modifies Markdown to add annotation markers. For every note with
annotation history, it stores one JSON sidecar containing the last reconciled
content snapshot and dated ranges. The sidecars use opaque filenames and keep the
note path inside the JSON record, so renames can be tracked safely.

The plugin's `data.json` contains settings plus a compact annotation index used to
color notes without loading every sidecar at startup. If you sync a vault between
devices, include the hidden `.daymark` folder as well as the normal Obsidian
configuration folder.

Daymark is local-only. It does not make network requests or send note contents to
external services.

## Color palette

Daymark uses the open-source [Flexoki](https://stephango.com/flexoki) palette by Steph Ango. Light and dark themes have separate defaults, and both cycles begin with red.

## Commands

- **Show day legend**
- **Toggle annotations**
- **Reset annotation baseline**

## Settings

Open **Settings → Community plugins → Daymark** to:

- Choose ordered or stable-random color selection
- Edit separate light- and dark-mode colors for every cycle position
- Move colors earlier or later
- Add as many colors as desired
- Remove colors while keeping at least one
- Restore the original Flexoki palettes
- Loop back to the first color or keep using the final color
- Show or hide timestamp tooltips
- Show or hide tooltips for today’s annotations
- Choose whether annotation colors apply to wiki and external links
- Choose whether completed-task strikethroughs are colored by completion date

## Manual install

1. Download `main.js`, `manifest.json`, and `styles.css` from the latest GitHub release.
2. Create a folder named `daymark` inside your vault’s `.obsidian/plugins/` folder.
3. Place those three files in `.obsidian/plugins/daymark/`.
4. Reload Obsidian.
5. Enable Daymark under **Settings → Community plugins**.

## Limitations

- Outside edits cannot reveal their true historical date, so newly detected text is dated when Daymark reconciles the change.
- Already-checked tasks are not retroactively assigned a completion date.
- Metadata sync depends on your vault and plugin-data sync configuration.

## Development

```bash
npm install
npm test
npm run build
npm run lint
```
