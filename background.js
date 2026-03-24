// background.js — Service Worker
// Runs in the background, manages timer state and tab locking.

const ALARM_NAME = 'task-at-hand-tick';
const ALARM_PERIOD_MINUTES = 0.5; // 30-second polling interval

// ---------------------------------------------------------------------------
// Icon drawing via OffscreenCanvas
// (document.createElement('canvas') is not available in service workers)
// ---------------------------------------------------------------------------

function drawLockIcon(locked, size) {
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext('2d');
  const s = size / 16; // all measurements in a 16-unit grid

  ctx.clearRect(0, 0, size, size);

  const bodyFill   = locked ? '#FFD700' : '#9E9E9E';
  const bodyStroke = locked ? '#B8860B' : '#555555';
  const shackleColor = locked ? '#FFC200' : '#757575';

  // --- Shackle (the U-shaped arch at the top) ---
  ctx.strokeStyle = shackleColor;
  ctx.lineWidth   = Math.max(1.5, s * 2);
  ctx.lineCap     = 'round';
  ctx.beginPath();

  if (locked) {
    // Both legs go into the body — closed arch
    ctx.moveTo(4.5 * s, 8.5 * s);
    ctx.lineTo(4.5 * s, 5.5 * s);
    ctx.arc(8 * s, 5.5 * s, 3.5 * s, Math.PI, 0);
    ctx.lineTo(11.5 * s, 8.5 * s);
  } else {
    // Right leg is lifted — open shackle
    ctx.moveTo(4.5 * s, 8.5 * s);
    ctx.lineTo(4.5 * s, 5.5 * s);
    ctx.arc(8 * s, 5.5 * s, 3.5 * s, Math.PI, Math.PI * 1.75);
    // right leg endpoint floats above the body, no line into body
  }
  ctx.stroke();

  // --- Body (rounded rectangle, lower portion) ---
  ctx.lineWidth = Math.max(1, s);
  ctx.strokeStyle = bodyStroke;
  ctx.fillStyle   = bodyFill;

  const bx = 2 * s, by = 8 * s, bw = 12 * s, bh = 7 * s, br = 1.5 * s;
  ctx.beginPath();
  ctx.moveTo(bx + br, by);
  ctx.lineTo(bx + bw - br, by);
  ctx.arcTo(bx + bw, by,       bx + bw, by + br,       br);
  ctx.lineTo(bx + bw, by + bh - br);
  ctx.arcTo(bx + bw, by + bh,  bx + bw - br, by + bh,  br);
  ctx.lineTo(bx + br, by + bh);
  ctx.arcTo(bx,       by + bh,  bx, by + bh - br,       br);
  ctx.lineTo(bx,      by + br);
  ctx.arcTo(bx,       by,       bx + br, by,             br);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // --- Keyhole ---
  ctx.fillStyle = bodyStroke;
  ctx.beginPath();
  ctx.arc(8 * s, 11.5 * s, 1.5 * s, 0, Math.PI * 2);
  ctx.fill();
  // Small rectangular slot below the circle
  ctx.fillRect(7.3 * s, 12.5 * s, 1.4 * s, 1.5 * s);

  return ctx.getImageData(0, 0, size, size);
}

async function setIcon(locked) {
  await chrome.action.setIcon({
    imageData: {
      16:  drawLockIcon(locked, 16),
      48:  drawLockIcon(locked, 48),
      128: drawLockIcon(locked, 128),
    },
  });
}

async function setBadge(remaining) {
  if (remaining === null) {
    await chrome.action.setBadgeText({ text: '' });
    return;
  }
  const mins = Math.ceil(remaining / 60);
  const label = mins >= 60 ? `${Math.floor(mins / 60)}h` : `${mins}m`;
  await chrome.action.setBadgeText({ text: label });
  await chrome.action.setBadgeBackgroundColor({ color: '#B8860B' });
}

// ---------------------------------------------------------------------------
// State helpers (chrome.storage.local, because service workers can be killed)
// ---------------------------------------------------------------------------

const DEFAULT_STATE = {
  isRunning:   false,
  endTime:     null,
  originTabId: null,
};

async function getState() {
  const stored = await chrome.storage.local.get(Object.keys(DEFAULT_STATE));
  return { ...DEFAULT_STATE, ...stored };
}

async function patchState(updates) {
  await chrome.storage.local.set(updates);
}

// ---------------------------------------------------------------------------
// Timer lifecycle
// ---------------------------------------------------------------------------

async function startTimer(tabId, durationSeconds) {
  const endTime = Date.now() + durationSeconds * 1000;

  await patchState({
    isRunning:   true,
    endTime:     endTime,
    originTabId: tabId,
  });

  // chrome.alarms has a ~30-second minimum delay in MV3.
  // We use a repeating alarm to poll; the popup countdown is driven by
  // endTime - Date.now(), so display accuracy is unaffected.
  await chrome.alarms.create(ALARM_NAME, { periodInMinutes: ALARM_PERIOD_MINUTES });

  await setIcon(true);
  await setBadge(durationSeconds);
}

async function stopTimer() {
  await chrome.alarms.clear(ALARM_NAME);
  await chrome.storage.local.set(DEFAULT_STATE);
  await setIcon(false);
  await setBadge(null);
}

// ---------------------------------------------------------------------------
// Tab locking
// ---------------------------------------------------------------------------

// Block new tab creation — close any tab that appears while timer is running.
chrome.tabs.onCreated.addListener(async (tab) => {
  const state = await getState();
  if (!state.isRunning) return;

  try {
    await chrome.tabs.remove(tab.id);
  } catch {
    // Already gone — nothing to do.
  }
});

// Block switching to a different tab — redirect back to the origin tab.
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  const state = await getState();
  if (!state.isRunning) return;
  if (activeInfo.tabId === state.originTabId) return;

  try {
    await chrome.tabs.get(state.originTabId); // throws if tab is gone
  } catch {
    // Origin tab truly no longer exists — release the lock.
    await stopTimer();
    return;
  }

  // Tab exists — redirect back. Chrome may reject tab edits during the
  // tab-switch animation ("user may be dragging a tab"), so retry after a
  // short delay if the first attempt fails.
  const redirect = async () => {
    const originTab = await chrome.tabs.get(state.originTabId);
    await chrome.windows.update(originTab.windowId, { focused: true });
    await chrome.tabs.update(state.originTabId, { active: true });
  };

  try {
    await redirect();
  } catch (err) {
    //  If we fail to redirect, it's because the user is in the middle of switching tabs, 
    // which temporarily locks out tab updates. Retry after a short delay.
    setTimeout(() => redirect().catch(() => {}), 200);
  }
});

// Release the lock automatically if the origin tab is closed.
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const state = await getState();
  if (!state.isRunning) return;
  if (tabId === state.originTabId) {
    await stopTimer();
  }
});

// ---------------------------------------------------------------------------
// Alarm handler — polling tick to detect expiry
// ---------------------------------------------------------------------------

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ALARM_NAME) return;

  const state = await getState();
  if (!state.isRunning || !state.endTime) return;

  const remaining = (state.endTime - Date.now()) / 1000;

  if (remaining <= 0) {
    await stopTimer();
    // Notify popup if it happens to be open.
    chrome.runtime.sendMessage({ type: 'TIMER_FINISHED' }).catch(() => {});
  } else {
    // Keep the badge up-to-date.
    await setBadge(remaining);
  }
});

// ---------------------------------------------------------------------------
// Message passing — popup communicates via chrome.runtime.sendMessage
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message)
    .then(sendResponse)
    .catch((err) => sendResponse({ error: err.message }));
  return true; // Keep the message channel open for the async response.
});

async function handleMessage(message) {
  switch (message.type) {
    case 'GET_STATE': {
      const state = await getState();
      if (state.isRunning && state.endTime !== null) {
        const remaining = Math.max(0, (state.endTime - Date.now()) / 1000);
        return { ...state, remaining };
      }
      return state;
    }

    case 'START_TIMER': {
      await startTimer(message.tabId, message.duration);
      return { success: true };
    }

    case 'STOP_TIMER': {
      await stopTimer();
      return { success: true };
    }

    default:
      return { error: `Unknown message type: ${message.type}` };
  }
}

// ---------------------------------------------------------------------------
// Initialization — runs each time the service worker wakes up
// ---------------------------------------------------------------------------

(async () => {
  const state = await getState();

  if (state.isRunning && state.endTime !== null) {
    const remaining = (state.endTime - Date.now()) / 1000;

    if (remaining <= 0) {
      // Timer already expired while service worker was asleep.
      await stopTimer();
    } else {
      // Restore the locked icon and badge after a service worker restart.
      await setIcon(true);
      await setBadge(remaining);
    }
  } else {
    await setIcon(false);
    await setBadge(null);
  }
})();
