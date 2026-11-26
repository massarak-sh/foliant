# Foliant

A calm, reliable writing app for fiction. One window, projects in tabs, a binder you can reshape freely, and saving you never have to think about.

> Status: **phase 1**: writing, binder, crash-safe saving, snapshots and word counts. Backups to Google Drive, comments, notes, page view, export and Scrivener import come in the next phases.

---

## Trying it on Windows

### Easiest: download the installer

1. Open the repository on GitHub and go to **Actions** → **Build** → the most recent run with a green tick.
2. At the bottom of that page, under **Artifacts**, download **Foliant-Windows-installer**. It's a zip file.
3. Unzip it and double-click **Foliant-Setup-0.1.0.exe**.
4. Windows will probably say *"Windows protected your PC"*, because the app isn't signed by a paid certificate yet. Click **More info** → **Run anyway**.
5. The installer adds Foliant to the Start menu and the desktop.

### For tinkering: run it from the source code

You only need this if you want to run the newest unreleased code.

1. Install **Node.js LTS** from <https://nodejs.org> (the big green button, default options).
2. Open **PowerShell** and run:
   ```powershell
   git clone https://github.com/massarak-sh/foliant.git
   cd foliant
   npm install
   npm run dev
   ```
   (No git? On GitHub, use **Code → Download ZIP**, unzip it, open PowerShell in that folder and run the last two lines.)
3. To make your own installer: `npm run dist:win`. It ends up in the `dist` folder.

---

## Using Foliant

- **New project**: pick a title and a folder (by default `Documents\Foliant`). Every project is one folder ending in `.foliant`.
- **Tabs**: each open project is a tab at the top; the house icon opens or creates more.
- **Binder** (left):
  - **+ Chapter / + Scene / + Section** add an item where you'd expect: a new scene goes after the selected scene, or inside the selected chapter.
  - **Drag** items to move them. Drop on the top or bottom edge of an item to put it before or after; drop in the middle to put it *inside*.
  - **Right-click** an item to rename it, **turn it into** a part, chapter, section, scene, folder or note (any time, in any direction), indent or outdent it, or move it to the trash.
  - Keyboard: **F2** renames, **Tab / Shift+Tab** indent and outdent, **Delete** moves to trash, arrow keys move around.
  - Any item can contain text *and* other items, so a chapter can have its own opening text and scenes inside it.
- **Writing**: formatting toolbar on top: bold, italic, underline, strikethrough, highlight, alignment, headings, block quote, and a scene break (`* * *`). The writing column is exactly as wide as the text on a printed page.
- **Default text style**: EB Garamond 12 pt, line spacing 1.1. Change it in **⚙ Project settings**. The setting belongs to the project and later on export will use it too. A *Standard Manuscript Format* preset is ready for the export phase.
- **Snapshots**: **Ctrl+5** or the **Snapshot** button saves a copy of the current scene. In the **Snapshots** panel you can **Compare** a snapshot with the current text (added words in green, removed in red, or side by side), **Restore** it, rename it or delete it. Restoring always takes a snapshot of the current text first, so nothing is ever lost.
- **Quick reference**: right-click any scene → **Open as quick reference** to keep it visible on the right while you write another.
- **Counts** (bottom bar): words and characters in this scene, the whole manuscript, and **Today: +added −removed (net)** plus **This session**. Daily totals are saved in the project, ready for the history charts coming later. You can set a daily goal in settings.
- **Ctrl+S** isn't needed, but it works: it confirms everything is saved.

## How saving works (why you won't lose text)

Foliant saves by itself about half a second after you stop typing, and at least every 3 seconds while you type. Each save:

1. is first written to a **journal** and forced onto the disk,
2. is then written to a temporary file, **read back and checked**, and only then swapped in for the old file in one step, so a power cut can never leave a half-written scene,
3. is **checked again** after the swap.

On top of that:

- While you type, the very latest text is copied out every few keystrokes. If Foliant crashes before the next save, that text is put back the next time you open the project, and Foliant tells you so.
- Closing the window or a tab waits until everything is on disk.
- Every 10 minutes Foliant keeps a copy of the previous version of each file (the last 30 per file) in the project's hidden `.backups` folder. If a file is ever damaged, Foliant automatically uses the newest good copy.
- The bottom-right corner always tells you the truth: **Saved · time**, **Saving…**, or a red **Not saved yet, retrying** if the disk refuses (it keeps retrying and keeps your text).

Automatic backups of whole projects and upload to Google Drive are phase 2.

## Grammarly / ProWritingAid

The editor is a normal text area. The **Grammarly for Windows** and **ProWritingAid** desktop apps should be able to check it like any other app. Windows' own spell checker also works: right-click a misspelled word for suggestions.

## Project folder format

Everything is plain JSON, readable without Foliant:

```
My Novel.foliant/
  foliant.json          title, author, text style, page setup, languages
  binder.json           the binder tree: manuscript, notes & research, trash
  docs/<id>.json        the text of each item
  snapshots/<id>/…      snapshots of each item
  stats/days.json       words added / removed per day and the manuscript total
  notes/, comments/     reserved for the notes pane and comments (phase 3)
  .journal/             the safety journal (normally empty)
  .backups/             rolling copies of previous versions
```

Translations (phase 5) will live next to the original as `docs/<id>@<lang>.json`, so a scene and its translation can be shown side by side.

## Roadmap

1. ✅ Editor, binder, crash-safe saving, snapshots, counts
2. Automatic project backups and upload to Google Drive (through Google's API, no Drive app needed)
3. Count history over time, comments, notes pane
4. Real page view and export: DOCX, PDF, EPUB, FB2, standard manuscript format, whole book or chosen parts
5. Scrivener import, side-by-side language versions

## For developers

```
npm run dev        # app with hot reload
npm test           # unit tests (storage, counting, binder)
npm run typecheck
npm run test:e2e   # drives the real app with Playwright (needs `playwright` installed; on Linux use xvfb-run)
npm run dist:win   # Windows installer → dist/
```

Code: `src/main` (Electron main process, all disk access in `src/main/storage`), `src/preload` (the bridge), `src/renderer` (React UI with a TipTap editor), `src/shared` (types, binder operations, counting).
