(() => {
  'use strict';

  // Elements
  const els = {
    ring: document.getElementById('ring'),
    time: document.getElementById('time'),
    input: document.getElementById('timeInput'),
    applyBtn: document.getElementById('applyBtn'),
    startPauseBtn: document.getElementById('startPauseBtn'),
    resetBtn: document.getElementById('resetBtn'),
    stopBtn: document.getElementById('stopBtn'),
  };

  // State
  let durationMs = loadLastDuration() || 25 * 60 * 1000;
  let remainingMs = durationMs;
  let running = false;
  let endAt = null;
  let tickTimer = null;
  let audioCtx = null;
  let alarmInterval = null;
  let alarmActive = false;
  let activeSources = new Set();

  // Init
  setDuration(durationMs);
  els.input.value = formatAsInput(durationMs);
  updateDisplay(remainingMs);
  updateRing(0);
  // Use PNG directly as favicon (no JPEG conversion)
  applyFavicon('images/clock.png', 'image/png');

  // Events
  els.applyBtn.addEventListener('click', () => {
    const ms = parseTimeInput(els.input.value.trim());
    if (ms > 0) {
      setDuration(ms);
    } else {
      flashInputInvalid();
    }
  });

  document.querySelectorAll('[data-set]').forEach(btn => {
    btn.addEventListener('click', () => {
      const ms = parseTimeInput(btn.getAttribute('data-set'));
      if (ms > 0) setDuration(ms);
    });
  });

  els.startPauseBtn.addEventListener('click', () => {
    if (running) pause(); else start();
  });

  els.resetBtn.addEventListener('click', () => reset());
  els.stopBtn.addEventListener('click', () => stopAlarm());

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') {
      e.preventDefault();
      if (running) pause(); else start();
    } else if (e.key.toLowerCase() === 'r') {
      e.preventDefault();
      reset();
    }
  });

  // Logic
  function start() {
    stopAlarm();
    if (remainingMs <= 0) {
      // If finished, restart from duration
      remainingMs = durationMs;
    }
    endAt = Date.now() + remainingMs;
    running = true;
    els.startPauseBtn.textContent = '一時停止';
    els.startPauseBtn.classList.remove('btn-primary');
    els.startPauseBtn.classList.add('btn');
    tickTimer = startTicker();
  }

  function pause() {
    running = false;
    clearInterval(tickTimer);
    tickTimer = null;
    remainingMs = Math.max(0, endAt - Date.now());
    updateDisplay(remainingMs);
    updateProgress();
    els.startPauseBtn.textContent = '再開';
    els.startPauseBtn.classList.add('btn-primary');
  }

  function reset() {
    stopAlarm();
    running = false;
    clearInterval(tickTimer);
    tickTimer = null;
    remainingMs = durationMs;
    updateDisplay(remainingMs);
    updateRing(0);
    document.title = 'タイマー';
    els.startPauseBtn.textContent = '開始';
    els.startPauseBtn.classList.add('btn-primary');
  }

  function setDuration(ms) {
    durationMs = ms;
    saveLastDuration(durationMs);
    remainingMs = ms;
    updateDisplay(remainingMs);
    updateRing(0);
    if (running) {
      // Restart with new duration
      clearInterval(tickTimer);
      endAt = Date.now() + remainingMs;
      tickTimer = startTicker();
    }
    els.input.value = formatAsInput(ms);
  }

  function startTicker() {
    // Update at ~10fps (100ms) for smoothness without heavy CPU
    return setInterval(() => {
      const now = Date.now();
      remainingMs = Math.max(0, endAt - now);
      updateDisplay(remainingMs);
      updateProgress();
      if (remainingMs <= 0) {
        clearInterval(tickTimer);
        tickTimer = null;
        running = false;
        onFinished();
      }
    }, 100);
  }

  function onFinished() {
    els.startPauseBtn.textContent = '開始';
    els.startPauseBtn.classList.add('btn-primary');
    updateRing(1);
    startAlarm();
    document.title = '終了 - タイマー';
  }

  function updateProgress() {
    const progress = 1 - clamp(remainingMs / durationMs, 0, 1);
    updateRing(progress);
    document.title = `${formatTime(remainingMs)} - タイマー`;
  }

  function updateDisplay(ms) {
    els.time.textContent = formatTime(ms);
  }

  function updateRing(progress01) {
    els.ring.style.setProperty('--p', String(progress01));
  }

  function parseTimeInput(text) {
    if (!text) return 0;
    const s = text.trim();
    // Accept mm:ss, m:ss, s, or m
    if (/^\d+:\d{1,2}$/.test(s)) {
      const [m, sec] = s.split(':').map(Number);
      return (m * 60 + sec) * 1000;
    }
    if (/^\d+$/.test(s)) {
      // treat as seconds when only digits
      return Number(s) * 1000;
    }
    // Accept mm:ss with leading zeros or variations like 05m30s
    const match = s.match(/(?:(\d+)m)?\s*(?:(\d+)s)?/i);
    if (match && (match[1] || match[2])) {
      const m = Number(match[1] || 0);
      const sec = Number(match[2] || 0);
      return (m * 60 + sec) * 1000;
    }
    return 0;
  }

  function formatTime(ms) {
    const total = Math.max(0, Math.round(ms / 1000));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  function formatAsInput(ms) {
    return formatTime(ms);
  }

  function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }

  // Bell alarm that repeats until stopped
  function startAlarm() {
    if (alarmActive) return;
    alarmActive = true;
    strikeBell();
    alarmInterval = setInterval(strikeBell, 2000);
  }

  function stopAlarm() {
    if (!alarmActive) return;
    alarmActive = false;
    if (alarmInterval) {
      clearInterval(alarmInterval);
      alarmInterval = null;
    }
    // Smooth fade-out to avoid clicks/pops, then stop
    if (audioCtx) {
      const now = audioCtx.currentTime;
      activeSources.forEach(({ osc, gain }) => {
        try {
          if (gain) {
            const current = Math.max(0.0001, gain.gain.value || 0.0001);
            gain.gain.cancelScheduledValues(now);
            gain.gain.setValueAtTime(current, now);
            gain.gain.linearRampToValueAtTime(0.0001, now + 0.12);
          }
          if (osc && osc.stop) osc.stop(now + 0.18);
        } catch {}
      });
      // Clear references shortly after fade completes
      setTimeout(() => activeSources.clear(), 220);
    } else {
      activeSources.clear();
    }
  }

  function strikeBell() {
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();

      // Simple FM synthesis for bell-like timbre
      const now = audioCtx.currentTime;
      const dur = 1.8; // seconds per strike

      // Modulator
      const mod = audioCtx.createOscillator();
      const modGain = audioCtx.createGain();
      mod.type = 'sine';
      mod.frequency.setValueAtTime(920, now); // modulator freq
      modGain.gain.setValueAtTime(0, now);
      modGain.gain.setTargetAtTime(150, now, 0.01); // index ramp up
      modGain.gain.setTargetAtTime(0.001, now + 0.05, 0.6); // decay index

      // Carrier
      const carrier = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      carrier.type = 'sine';
      carrier.frequency.setValueAtTime(660, now); // base bell pitch
      // Add slight inharmonic partial by detune
      const partial = audioCtx.createOscillator();
      const partialGain = audioCtx.createGain();
      partial.type = 'sine';
      partial.frequency.setValueAtTime(660 * 2.4, now); // inharmonic ratio
      partialGain.gain.setValueAtTime(0.0, now);
      partialGain.gain.setTargetAtTime(0.15, now, 0.01);
      partialGain.gain.setTargetAtTime(0.0001, now + 0.05, 0.8);

      // Amplitude envelope (strike then decay)
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.8, now + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);

      // Wire FM: mod -> modGain -> carrier.frequency
      mod.connect(modGain);
      modGain.connect(carrier.frequency);

      // Mix carrier + partial
      const mix = audioCtx.createGain();
      mix.gain.value = 0.9;
      carrier.connect(mix);
      partial.connect(partialGain).connect(mix);
      mix.connect(gain).connect(audioCtx.destination);

      // Start/stop
      mod.start(now);
      carrier.start(now);
      partial.start(now);
      carrier.stop(now + dur + 0.1);
      partial.stop(now + dur + 0.1);
      mod.stop(now + dur + 0.1);

      const ref = { osc: carrier, gain };
      activeSources.add(ref);
      setTimeout(() => activeSources.delete(ref), (dur + 0.2) * 1000);
    } catch {}
  }

  function flashInputInvalid() {
    els.input.style.outline = `2px solid var(--danger)`;
    setTimeout(() => (els.input.style.outline = ''), 500);
  }

  function saveLastDuration(ms) {
    try { localStorage.setItem('timer:last', String(ms)); } catch {}
  }
  function loadLastDuration() {
    try { return Number(localStorage.getItem('timer:last')) || 0; } catch { return 0; }
  }
  
  // --- Favicon helpers ---
  function applyFavicon(href, type) {
    // Replace existing rel=icon if present; otherwise create one.
    let link = document.querySelector('link[rel="icon"]');
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.head.appendChild(link);
    }
    if (type) link.type = type;
    link.href = href;
  }
})();
