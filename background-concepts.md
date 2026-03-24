# Background Concepts: Task At Hand Chrome Extension

A guide for software developers who are comfortable with general programming but new to Chrome extension development. Each section explains a concept used in this codebase and why it exists.

---

## 1. Manifest V3 (MV3)

The `manifest.json` file is the extension's entry point and configuration contract with Chrome. It declares what the extension is, what permissions it needs, and which files play which roles.

**Manifest Version 3** is the current standard (replacing V2, which Google deprecated in 2023). The key differences relevant here:

- Background scripts must be **service workers**, not persistent background pages.
- No inline scripts are allowed in HTML (Content Security Policy).
- Permissions must be explicitly declared and are shown to users before install.

```json
{
  "manifest_version": 3,
  "permissions": ["tabs", "alarms", "storage", "windows"],
  "background": { "service_worker": "background.js" },
  "action": { "default_popup": "popup.html" }
}
```

Think of `manifest.json` as a combination of a package manifest and an OS app registration — it tells Chrome everything it needs to know to host the extension.

---

## 2. Service Workers as Background Scripts

In MV3, the extension's background logic runs in a **service worker** (`background.js`). This is the same type of service worker used in Progressive Web Apps.

**Key property: service workers are not persistent.** Chrome can terminate the service worker at any time when it's idle (typically after 30 seconds of inactivity) and restart it when an event fires. This means:

- You cannot store state in module-level variables across events — they will be reset on restart.
- All persistent state must live in `chrome.storage` (see §4).
- The initialization block at the bottom of `background.js` runs on **every** service worker startup, restoring state from storage.

If you're used to writing long-lived background daemons or Node.js servers, this is the biggest mental shift. Think of each event handler as a lambda that cold-starts, reads state from a database, does its work, writes state back, and exits.

```js
// This runs every time the service worker wakes up (potentially many times per session)
(async () => {
  const state = await getState();
  if (state.isRunning) {
    await setIcon(true); // re-apply because the SW may have restarted
  }
})();
```

---

## 3. chrome.alarms — Timers That Survive Service Worker Termination

You cannot use `setTimeout` or `setInterval` for long-running timers in a service worker, because the service worker will be killed before they fire.

**`chrome.alarms`** is the Chrome-native equivalent. Alarms are registered with Chrome itself (not just your JS runtime), so they persist even if the service worker is terminated and restarted.

```js
// Create a repeating alarm — fires every 30 seconds
await chrome.alarms.create('task-at-hand-tick', { periodInMinutes: 0.5 });

// Handle it — Chrome restarts the SW to deliver this event
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'task-at-hand-tick') {
    // check if timer expired...
  }
});
```

**Minimum interval:** Chrome enforces a minimum alarm period of ~30 seconds in MV3. This means the timer won't unlock at the exact millisecond for very short durations — but this is fine for a focus tool. The popup's countdown display is driven by `Date.now() - startTime` (accurate to the millisecond), while the alarm is only used to trigger the actual state change.

Analogy: `chrome.alarms` is like `cron` — it's managed by the OS, not the process, so it fires reliably even if your process was not running.

---

## 4. chrome.storage — Persistent State Across Service Worker Restarts

`localStorage` and other in-memory stores are wiped when the service worker is killed. `chrome.storage.local` persists across restarts and is the standard way to store extension state.

```js
// Write
await chrome.storage.local.set({ isRunning: true, endTime: Date.now() + 60000 });

// Read
const { isRunning, endTime } = await chrome.storage.local.get(['isRunning', 'endTime']);
```

It is fully async (Promise-based). Think of it like a small key-value database scoped to the extension. Unlike `localStorage`, it's available in the service worker context.

`chrome.storage.session` also exists (cleared on browser close), but `storage.local` is used here because the timer should survive accidental browser crashes.

---

## 5. chrome.tabs — Querying and Controlling Tabs

The `tabs` permission unlocks the `chrome.tabs` API, which lets you query, create, update, and remove browser tabs.

**Tab lifecycle events used in this extension:**

| Event | When it fires | Used for |
|---|---|---|
| `tabs.onCreated` | A new tab is opened anywhere | Close the tab if timer is running |
| `tabs.onActivated` | The user switches to a different tab | Redirect back to the origin tab |
| `tabs.onRemoved` | A tab is closed | Release the lock if the origin tab was closed |

```js
// Redirect the user back to the locked tab when they try to switch away
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  const state = await getState();
  if (state.isRunning && tabId !== state.originTabId) {
    await chrome.tabs.update(state.originTabId, { active: true });
  }
});
```

**Tab IDs** are integers assigned by Chrome. They're stable for the lifetime of the tab but not across sessions. This extension stores `originTabId` in `chrome.storage` so the service worker can reference the locked tab even after a restart.

---

## 6. chrome.windows — Multi-Window Focus

The `windows` permission gives access to `chrome.windows`, which controls browser window focus. It's needed here because a user might try to switch tabs by clicking a different Chrome window entirely. Without window-level focus management, `chrome.tabs.update` would make the correct tab active within its window, but the other window would still be in the foreground.

```js
const originTab = await chrome.tabs.get(state.originTabId);
await chrome.windows.update(originTab.windowId, { focused: true }); // bring window forward
await chrome.tabs.update(state.originTabId, { active: true });       // switch to tab within it
```

---

## 7. chrome.action — The Toolbar Button

`chrome.action` controls the extension's button in the Chrome toolbar. Key capabilities:

- **`setIcon`** — dynamically change the icon (used for locked/unlocked states)
- **`setBadgeText`** — show a small text overlay on the icon (used for remaining time)
- **`setBadgeBackgroundColor`** — set the badge's background color
- **`default_popup`** in the manifest — specifies which HTML file opens when the button is clicked

The popup is a lightweight HTML/JS/CSS page that lives in its own isolated context (see §9).

---

## 8. OffscreenCanvas — Drawing Images in a Service Worker

The service worker has no access to the DOM, so `document.createElement('canvas')` doesn't work. **`OffscreenCanvas`** is the DOM-free canvas API that works in workers (including service workers).

This extension uses it to draw the locked (gold) and unlocked (gray) padlock icons at runtime, instead of shipping static PNG files:

```js
function drawLockIcon(locked, size) {
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext('2d');
  // ... draw padlock using standard Canvas 2D API ...
  return ctx.getImageData(0, 0, size, size); // returns ImageData, not a <canvas>
}

await chrome.action.setIcon({
  imageData: {
    16:  drawLockIcon(locked, 16),
    48:  drawLockIcon(locked, 48),
    128: drawLockIcon(locked, 128),
  },
});
```

`chrome.action.setIcon` accepts either file `path` references or `imageData` (an `ImageData` object from canvas). Using `imageData` avoids needing to ship separate PNG files for each state.

---

## 9. Message Passing — Popup ↔ Service Worker Communication

The popup (`popup.js`) and the service worker (`background.js`) are **separate JavaScript contexts** — they do not share memory. To communicate, they use Chrome's message passing system.

```js
// popup.js — sends a request
const state = await chrome.runtime.sendMessage({ type: 'GET_STATE' });

// background.js — handles it
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message).then(sendResponse);
  return true; // Returning `true` keeps the channel open for async responses.
});
```

The `return true` in the listener is a common gotcha: without it, the channel closes synchronously and `sendResponse` will fail when called asynchronously.

Think of this like an HTTP request/response model, where the popup is the client and the service worker is the server, except the transport is Chrome's IPC rather than a network socket.

---

## 10. Extension JavaScript Contexts

A Chrome extension can have multiple isolated JS execution contexts running simultaneously:

| Context | File(s) | Access to DOM? | Access to chrome.* APIs? |
|---|---|---|---|
| Service Worker | `background.js` | No | Yes (most) |
| Popup | `popup.js` + `popup.html` | Yes (popup DOM) | Yes |
| Content Script | (not used here) | Yes (page DOM) | Partial |

Each context has its own memory space. Global variables set in the popup are not visible in the service worker and vice versa. Shared state must go through `chrome.storage` or message passing.

The popup is created fresh each time it's opened and destroyed when it's closed — its `pollInterval` is cleared by garbage collection when the popup window closes.
