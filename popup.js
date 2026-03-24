// popup.js — runs in the extension popup context (a separate JS environment
// from the service worker; communication happens via chrome.runtime.sendMessage)

let pollInterval = null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTime(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return [h, m, sec].map((v) => String(v).padStart(2, '0')).join(':');
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function setInputsFromSeconds(totalSeconds) {
  document.getElementById('inp-hours').value   = pad2(Math.floor(totalSeconds / 3600));
  document.getElementById('inp-minutes').value = pad2(Math.floor((totalSeconds % 3600) / 60));
  document.getElementById('inp-seconds').value = pad2(totalSeconds % 60);
}

function readInputSeconds() {
  const h = parseInt(document.getElementById('inp-hours').value,   10) || 0;
  const m = parseInt(document.getElementById('inp-minutes').value, 10) || 0;
  const s = parseInt(document.getElementById('inp-seconds').value, 10) || 0;
  return h * 3600 + m * 60 + s;
}

// ---------------------------------------------------------------------------
// View switching
// ---------------------------------------------------------------------------

function showSetup() {
  document.getElementById('view-setup').classList.remove('hidden');
  document.getElementById('view-running').classList.add('hidden');
  document.getElementById('view-confirm').classList.add('hidden');
  document.getElementById('header-icon').textContent = '🔓';
  document.getElementById('error-msg').classList.add('hidden');
  stopPolling();
}

function showRunning(remaining) {
  document.getElementById('view-setup').classList.add('hidden');
  document.getElementById('view-running').classList.remove('hidden');
  document.getElementById('view-confirm').classList.add('hidden');
  document.getElementById('header-icon').textContent = '🔒';
  updateCountdown(remaining);
  startPolling();
}

function showConfirmUnlock(confirmRemaining) {
  document.getElementById('view-setup').classList.add('hidden');
  document.getElementById('view-running').classList.add('hidden');
  document.getElementById('view-confirm').classList.remove('hidden');
  document.getElementById('header-icon').textContent = '🔒';
  updateConfirmCountdown(confirmRemaining);
  startPolling();
}

function updateCountdown(remaining) {
  document.getElementById('countdown').textContent = formatTime(remaining);
}

function updateConfirmCountdown(remaining) {
  document.getElementById('confirm-countdown').textContent = formatTime(remaining);
}

// ---------------------------------------------------------------------------
// Polling — keeps countdown accurate while popup is open
// ---------------------------------------------------------------------------

function startPolling() {
  stopPolling();
  pollInterval = setInterval(async () => {
    const state = await chrome.runtime.sendMessage({ type: 'GET_STATE' });
    if (!state || !state.isRunning) {
      showSetup();
    } else if (state.isConfirmingUnlock) {
      updateConfirmCountdown(state.confirmRemaining ?? 0);
    } else {
      updateCountdown(state.remaining);
    }
  }, 500);
}

function stopPolling() {
  if (pollInterval !== null) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
}

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

async function init() {
  const state = await chrome.runtime.sendMessage({ type: 'GET_STATE' });
  if (state && state.isRunning) {
    if (state.isConfirmingUnlock) {
      showConfirmUnlock(state.confirmRemaining ?? 0);
    } else {
      showRunning(state.remaining);
    }
  } else {
    showSetup();
  }
}

// ---------------------------------------------------------------------------
// Event listeners
// ---------------------------------------------------------------------------

document.getElementById('btn-start').addEventListener('click', async () => {
  const totalSeconds = readInputSeconds();
  const errorEl = document.getElementById('error-msg');

  if (totalSeconds < 1 || totalSeconds > 10800) {
    errorEl.classList.remove('hidden');
    return;
  }
  errorEl.classList.add('hidden');

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  await chrome.runtime.sendMessage({ type: 'START_TIMER', tabId: tab.id, duration: totalSeconds });
  showRunning(totalSeconds);
});

document.getElementById('btn-stop').addEventListener('click', async () => {
  const state = await chrome.runtime.sendMessage({ type: 'START_UNLOCK_CONFIRM' });
  if (state && state.success) {
    showConfirmUnlock(60);
  }
});

document.getElementById('btn-resume-lock').addEventListener('click', async () => {
  const state = await chrome.runtime.sendMessage({ type: 'CANCEL_UNLOCK_CONFIRM' });
  if (state && state.success) {
    const fresh = await chrome.runtime.sendMessage({ type: 'GET_STATE' });
    showRunning(fresh.remaining ?? 0);
  }
});

// Preset buttons set the time inputs without starting the timer.
document.querySelectorAll('.preset').forEach((btn) => {
  btn.addEventListener('click', () => {
    const seconds = parseInt(btn.dataset.s, 10);
    setInputsFromSeconds(seconds);
    document.getElementById('error-msg').classList.add('hidden');
  });
});

// Listen for the background signalling that the timer finished naturally.
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'TIMER_FINISHED') {
    showSetup();
  }
});

// Select all on focus so typing immediately replaces the value.
['inp-hours', 'inp-minutes', 'inp-seconds'].forEach((id) => {
  document.getElementById(id).addEventListener('focus', (e) => e.target.select());
});

// Clamp and zero-pad inputs on blur so values stay in range and display as 00:00:00.
['inp-hours', 'inp-minutes', 'inp-seconds'].forEach((id) => {
  const input = document.getElementById(id);
  input.addEventListener('blur', () => {
    const min = parseInt(input.dataset.min, 10);
    const max = parseInt(input.dataset.max, 10);
    let val = parseInt(input.value, 10);
    if (isNaN(val)) val = 0;
    input.value = pad2(Math.min(max, Math.max(min, val)));
  });
});

init();
