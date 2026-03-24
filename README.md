# Task At Hand

A Chrome extension that locks you to the current tab for a set duration. Once a timer starts, no new tabs can be opened and switching to any other tab is blocked — you stay on the task at hand.

---

## Functionality

- **Set a timer** from 1 second up to 3 hours using hours/minutes/seconds inputs or quick presets (5m, 15m, 25m, 1h, 2h).
- **Start the timer** — the current tab becomes the locked tab.
- While the timer runs:
  - Opening a new tab (Ctrl+T, right-click → New tab, link → new tab) is blocked. The tab is closed immediately.
  - Switching to any other existing tab redirects you back to the locked tab.
  - Switching to a different Chrome window brings the locked window back into focus.
  - The extension icon changes to a **gold lock**.
  - The icon badge shows the remaining time (e.g. `25m`).
  - Clicking the extension icon shows a live countdown.
- **Stop early** by clicking "Unlock Early" in the popup.
- If the locked tab is **closed**, the timer stops and the lock is released automatically.
- When the timer expires naturally, the lock is released and the icon returns to the unlocked state.

---

## Dev Setup

### Prerequisites

- Google Chrome (or Chromium)
- No build step required — this is plain HTML/CSS/JS.

### Loading the Extension

1. Open Chrome and navigate to `chrome://extensions/`.
2. Enable **Developer mode** (toggle in the top-right corner).
3. Click **Load unpacked**.
4. Select the `taskathand/` directory.

The extension icon will appear in the Chrome toolbar. If it doesn't, click the puzzle-piece icon and pin "Task At Hand".

### Reloading After Code Changes

On `chrome://extensions/`, click the **reload** button (circular arrow) on the Task At Hand card. Then close and reopen any extension popup.

For service worker changes (`background.js`), you may also need to click **"Service Worker"** in the extension card to confirm it reloaded.

### Inspecting the Service Worker

On `chrome://extensions/`, click **"Service Worker"** next to the extension — this opens DevTools connected to the background service worker context, where you can see logs and set breakpoints.

### Inspecting the Popup

Right-click the extension icon → **Inspect Popup**. This opens DevTools for the popup's JS/HTML context.

---

## File Structure

```
taskathand/
├── manifest.json          Extension configuration and permissions
├── background.js          Service worker: timer logic, tab locking, icon drawing
├── popup.html             Popup UI markup
├── popup.js               Popup logic: inputs, countdown display, messaging
├── popup.css              Popup styles
├── background-concepts.md Technical concept guide for Chrome extension newcomers
├── README.md              This file
└── .claude/
    └── commands/
        └── update-concepts.md  Local Claude Code skill (see below)
```

---

## Known Limitations

- **Alarm granularity:** Chrome enforces a minimum alarm interval of ~30 seconds in Manifest V3. For very short timers (< 30 seconds), the lock is released up to ~30 seconds after the timer expires if the popup is closed. The countdown display in the popup is always accurate (it reads from `Date.now()`).
- **Tab flash:** When the user tries to switch to another tab, there is a brief visual flash before Chrome redirects back. Chrome extensions cannot block tab switches; the redirect happens in the next event loop tick.
- **Incognito:** The extension does not run in incognito windows unless explicitly allowed in `chrome://extensions/`.
- **Multiple profiles:** Tab locking applies only within the Chrome profile where the extension is installed.

---

## Local Skill: `/update-concepts`

This project includes a local Claude Code custom command at `.claude/commands/update-concepts.md`.

After making changes to the extension code, run:

```
/update-concepts
```

in Claude Code. It will review the current source files, compare them against `background-concepts.md`, and add documentation for any new Chrome extension APIs or patterns introduced. This keeps the concept guide in sync with the codebase over time.
