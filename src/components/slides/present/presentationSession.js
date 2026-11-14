// Presenter view session (spec D4/D5) — the browser port of desktop
// electron/presentation.js. One presentation session at a time, made of an
// AUDIENCE window (slide only) and a PRESENTER window (current/next slide,
// editable talking points, timer, pace guide).
//
// Desktop's main process owned the session; here the PRESENTER window owns
// it (this module, running in that window) and broadcasts the state on a
// BroadcastChannel('mtd-presentation-<deckId>') on every change. The
// audience window is a pure mirror: it — and the editor that started the
// talk — only send intents (goto, black screen, end, deck changed). Neither
// mirror talks to the other directly, so they can never drift out of sync.
//
// Window layout:
//   - 'projector': the Window Management API granted access to a second
//     screen → audience window on it (full screen after one click inside
//     it, which the browser requires), presenter on the editor's screen.
//   - 'window': single screen, no permission, or Firefox/Safari → audience
//     opens as a normal, shareable popup ("MTD — Audience: <title>") that
//     the presenter shares in a video call (or drags to a projector).
//   - 'rehearse': presenter window only.
//
// Message types are desktop's IPC channel names.

const AUDIENCE_WINDOW_SIZE = { width: 1280, height: 720 };
const STATE_REPLY_TIMEOUT_MS = 3000;

export const POPUP_BLOCKED_ERROR = 'Allow pop-ups for this site to open presenter view.';

function channelName(deckId) {
  return `mtd-presentation-${deckId}`;
}

const channels = new Map(); // deckId → BroadcastChannel (this window's)
const listeners = {
  state: new Set(),
  pointer: new Set(),
  deckChanged: new Set(),
  ended: new Set(),
  control: new Set(), // audience-window-only messages (fullscreen, focus)
};

function emitLocal(kind, payload) {
  listeners[kind].forEach((cb) => { try { cb(payload); } catch (e) { console.error(e); } });
}

function subscribe(kind, cb) {
  listeners[kind].add(cb);
  return () => listeners[kind].delete(cb);
}

// ---------------------------------------------------------------------------
// Role of this window
// ---------------------------------------------------------------------------

// 'editor' (default) | 'presenter' | 'audience'
let role = 'editor';
let roleDeckId = null;
let session = null; // presenter window only

function getChannel(deckId) {
  const key = String(deckId);
  if (typeof BroadcastChannel === 'undefined') return null;
  let ch = channels.get(key);
  if (ch) return ch;
  ch = new BroadcastChannel(channelName(key));
  ch.onmessage = (e) => onChannelMessage(key, e.data || {});
  channels.set(key, ch);
  return ch;
}

function post(deckId, type, payload) {
  getChannel(deckId)?.postMessage({ type, deckId: String(deckId), payload });
}

function onChannelMessage(deckId, { type, payload }) {
  if (role === 'presenter' && session && session.deckId === deckId) {
    // Intents from the audience window / the editor.
    if (type === 'presentation:goto') { if (Number.isInteger(payload)) session.goto(payload); }
    else if (type === 'presentation:screen') session.setScreen(payload);
    else if (type === 'presentation:end') session.end();
    else if (type === 'presentation:get-state') session.broadcast();
    else if (type === 'presentation:deck-changed-request') session.refreshDeck();
    else if (type === 'presentation:audience-hello') session.audienceHello(payload);
    else if (type === 'presentation:audience-bye') session.audienceBye(payload);
    return;
  }
  if (role === 'audience' && roleDeckId === deckId) {
    if (type === 'presentation:state') emitLocal('state', payload);
    else if (type === 'presentation:pointer') emitLocal('pointer', payload);
    else if (type === 'presentation:deck-changed') emitLocal('deckChanged', payload);
    else if (type === 'presentation:end-window') emitLocal('control', { type: 'close' });
    else if (type === 'presentation:audience-control') emitLocal('control', payload);
    return;
  }
  if (role === 'editor') {
    if (type === 'presentation:ended') emitLocal('ended', payload);
  }
}

// Called by /present/presenter and /present/audience during their first
// render (before PresenterView/AudienceView mount and ask for the state).
export function attachPresentationWindow({ role: nextRole, deckId, startIndex, mode }) {
  const key = String(deckId);
  if (role === nextRole && roleDeckId === key) return;
  role = nextRole;
  roleDeckId = key;
  getChannel(key);
  if (nextRole === 'presenter') {
    session = createPresenterSession({ deckId: key, startIndex, mode });
  } else if (nextRole === 'audience') {
    post(key, 'presentation:audience-hello', { kind: isPopup() ? 'popup' : 'tab' });
    window.addEventListener('pagehide', () => {
      if (audienceMoving) return; // "Open as a tab instead": the tab takes over
      post(key, 'presentation:audience-bye', {});
    });
  }
}

function isPopup() {
  return !!window.opener || window.name.startsWith('mtd-audience-');
}

let audienceMoving = false;
let editorUnloadHooked = false;
// "Open as a tab instead" (browser-forced difference 3): a tab keeps
// rendering while covered, where a popup window may not.
export function moveAudienceToTab() {
  const url = new URL(window.location.href);
  url.searchParams.set('tab', '1');
  const tab = window.open(url.toString(), '_blank');
  if (!tab) return false;
  audienceMoving = true;
  window.close();
  return true;
}

// ---------------------------------------------------------------------------
// Public API (wrapped 1:1 by slidesApi.js under desktop's preload names)
// ---------------------------------------------------------------------------

// Editor: opens presenter view. Runs synchronously inside the click, so the
// popup blocker allows the window.
export function presentationStart({ deckId, startIndex, mode } = {}) {
  const key = String(deckId);
  getChannel(key); // the editor hears presentation:ended on it
  if (role === 'editor') {
    roleDeckId = key; // the editor's "End" sends to this deck
    // Closing the editor window ends the show, as desktop does when its main
    // window closes.
    if (!editorUnloadHooked) {
      editorUnloadHooked = true;
      window.addEventListener('pagehide', () => { if (roleDeckId) post(roleDeckId, 'presentation:end'); });
    }
  }
  const params = new URLSearchParams({ deckId: key });
  if (Number.isInteger(startIndex)) params.set('start', String(startIndex));
  if (mode === 'rehearse') params.set('mode', 'rehearse');
  const s = window.screen;
  const left = s.availLeft ?? 0;
  const top = s.availTop ?? 0;
  const features = `popup,left=${left},top=${top},width=${s.availWidth},height=${s.availHeight}`;
  const win = window.open(`/present/presenter?${params}`, `mtd-presenter-${key}`, features);
  if (!win) return { success: false, error: POPUP_BLOCKED_ERROR };
  try { win.focus(); } catch (e) { /* ignore */ }
  return { success: true, mode: mode === 'rehearse' ? 'rehearse' : 'window' };
}

export function presentationGetState() {
  if (role === 'presenter') return session.ready.then(() => session.publicState());
  if (role !== 'audience') return Promise.resolve(null);
  return new Promise((resolve) => {
    const timer = setTimeout(() => { off(); resolve(null); }, STATE_REPLY_TIMEOUT_MS);
    const off = subscribe('state', (s) => { clearTimeout(timer); off(); resolve(s); });
    post(roleDeckId, 'presentation:get-state');
  });
}

export function presentationGoto(index) {
  if (role === 'presenter') session.goto(index);
  else if (roleDeckId) post(roleDeckId, 'presentation:goto', index);
}

export function presentationSetScreen(value) {
  if (role === 'presenter') session.setScreen(value);
  else if (roleDeckId) post(roleDeckId, 'presentation:screen', value);
}

export function presentationTimer(action) {
  if (role === 'presenter') session.setTimer(action);
}

// High-frequency and audience-only — forwarded without a state broadcast.
export function presentationPointer(point) {
  if (role !== 'presenter') return;
  const valid = point && Number.isFinite(point.x) && Number.isFinite(point.y);
  post(session.deckId, 'presentation:pointer', valid ? { x: point.x, y: point.y } : null);
}

export function presentationSwapDisplays() {
  if (role === 'presenter') session.swapDisplays();
}

export function presentationShowAudience() {
  if (role === 'presenter') session.showAudience();
}

// From any window: the editor's "End", the audience's Esc, presenter's End show.
export function presentationEnd(deckId) {
  if (role === 'presenter') { session.end(); return; }
  const key = deckId !== undefined ? String(deckId) : roleDeckId;
  if (key) post(key, 'presentation:end');
}

// Editor: slides were edited mid-talk → presenter refetches, tells audience.
export function presentationDeckChanged(deckId) {
  post(String(deckId), 'presentation:deck-changed-request');
}

export const onPresentationState = (cb) => subscribe('state', cb);
export const onPresentationPointer = (cb) => subscribe('pointer', cb);
export const onPresentationDeckChanged = (cb) => subscribe('deckChanged', cb);
export const onPresentationEnded = (cb) => subscribe('ended', cb);
export const onAudienceControl = (cb) => subscribe('control', cb);

// Presenter view only: whether the audience window is open, whether it was
// blocked, and the screen API's status — for the "Open the audience window"
// card and the Display settings menu.
export function onPresenterInfo(cb) {
  if (role !== 'presenter') return () => {};
  return session.onInfo(cb);
}
export function presenterInfo() {
  return role === 'presenter' ? session.info() : null;
}

// ---------------------------------------------------------------------------
// The session (presenter window)
// ---------------------------------------------------------------------------

function now() { return Date.now(); }

function elapsedMs(t) {
  return t.accumulated + (t.runningSince ? now() - t.runningSince : 0);
}

function centeredBounds(area, size) {
  const width = Math.min(size.width, area.width);
  const height = Math.min(size.height, area.height);
  return {
    left: Math.round(area.left + (area.width - width) / 2),
    top: Math.round(area.top + (area.height - height) / 2),
    width,
    height,
  };
}

// The shareable audience window: 16:9 like the slides (no letterbox bars in
// the call), at most 1280 wide and 85% of the screen.
function audienceBounds(area) {
  const width = Math.round(Math.min(AUDIENCE_WINDOW_SIZE.width, area.width * 0.85, (area.height * 0.85 * 16) / 9));
  return centeredBounds(area, { width, height: Math.round((width * 9) / 16) });
}

function areaOf(screenLike) {
  return {
    left: screenLike.availLeft ?? screenLike.left ?? 0,
    top: screenLike.availTop ?? screenLike.top ?? 0,
    width: screenLike.availWidth ?? screenLike.width,
    height: screenLike.availHeight ?? screenLike.height,
  };
}

function features(bounds) {
  return `popup,left=${bounds.left},top=${bounds.top},width=${bounds.width},height=${bounds.height}`;
}

// Screen details only when access was already granted — never prompts.
async function grantedScreenDetails() {
  if (!('getScreenDetails' in window)) return null;
  try {
    const status = await navigator.permissions.query({ name: 'window-management' });
    if (status.state !== 'granted') return null;
    return await window.getScreenDetails();
  } catch (e) {
    return null;
  }
}

function createPresenterSession({ deckId, startIndex, mode }) {
  const infoListeners = new Set();
  let audienceWin = null;
  let audienceAlive = false; // a mirror (popup or tab) said hello and hasn't left
  let blocked = false;
  let screenDetails = null;
  let wakeLock = null;
  let ending = false;
  let ended = false;
  let resolveReady;
  const ready = new Promise((r) => { resolveReady = r; });

  const s = {
    deckId,
    title: 'Slide deck',
    slideIds: [],
    index: 0,
    mode: mode === 'rehearse' ? 'rehearse' : 'window',
    screen: 'normal',
    timer: { accumulated: 0, runningSince: now() },
    slideTimes: {},
    slideEnteredAt: now(),
    loaded: false,
  };

  const currentSlideId = () => s.slideIds[s.index] ?? null;

  // Folds the time spent on the current slide (since it was entered or the
  // timer resumed) into slideTimes. Called before any change of slide or timer.
  const foldCurrentSlideTime = () => {
    const t = s.timer;
    if (!t.runningSince || !s.slideEnteredAt) return;
    const id = currentSlideId();
    if (id) s.slideTimes[id] = (s.slideTimes[id] || 0) + (now() - s.slideEnteredAt);
    s.slideEnteredAt = now();
  };

  // What the windows get. Times are sent as values + a reference timestamp so
  // each window can tick its own clock locally without a broadcast per second.
  const publicState = () => {
    if (!s.loaded) return null;
    const t = s.timer;
    return {
      deckId: s.deckId,
      title: s.title,
      index: s.index,
      slideCount: s.slideIds.length,
      mode: s.mode,
      screen: s.screen,
      displays: screenDetails ? screenDetails.screens.length : (window.screen.isExtended ? 2 : 1),
      timer: {
        running: !!t.runningSince,
        elapsedMs: elapsedMs(t),
        at: now(),
      },
      slideTimes: { ...s.slideTimes },
      currentSlideMs: (s.slideTimes[currentSlideId()] || 0) + (t.runningSince && s.slideEnteredAt ? now() - s.slideEnteredAt : 0),
    };
  };

  const broadcast = () => {
    const state = publicState();
    if (!state) return;
    emitLocal('state', state);
    post(deckId, 'presentation:state', state);
  };

  const info = () => ({
    audienceOpen: audienceAlive || !!(audienceWin && !audienceWin.closed),
    blocked,
    canPlaceOnScreens: 'getScreenDetails' in window,
    multiScreen: !!window.screen.isExtended,
  });
  const emitInfo = () => infoListeners.forEach((cb) => cb(info()));

  // ---- Displays ----------------------------------------------------------

  const presenterScreen = () => screenDetails?.currentScreen || null;
  const externalScreen = () => {
    if (!screenDetails) return null;
    const home = presenterScreen();
    return screenDetails.screens.find((sc) => sc !== home && sc.label !== home?.label) || null;
  };

  // Where the audience window goes for the current mode.
  const audienceTarget = () => {
    if (s.mode === 'projector') {
      const ext = externalScreen();
      if (ext) return { bounds: { ...areaOf(ext) }, fullscreen: true };
      s.mode = 'window'; // external display went away
    }
    return { bounds: audienceBounds(areaOf(presenterScreen() || window.screen)), fullscreen: false };
  };

  const placeAudience = () => {
    if (!audienceWin || audienceWin.closed) return;
    const { bounds, fullscreen } = audienceTarget();
    try {
      audienceWin.moveTo(bounds.left, bounds.top);
      audienceWin.resizeTo(bounds.width, bounds.height);
    } catch (e) { /* the browser may refuse; the window stays where it is */ }
    post(deckId, 'presentation:audience-control', { type: fullscreen ? 'want-fullscreen' : 'exit-fullscreen', mode: s.mode });
  };

  // Plugged in / unplugged mid-talk (Window Management's screenschange).
  const onScreensChanged = () => {
    if (s.mode === 'rehearse') return;
    const nextMode = externalScreen() ? 'projector' : 'window';
    if (nextMode === s.mode) return;
    s.mode = nextMode;
    placeAudience();
    broadcast();
  };

  // Opens (or re-focuses) the audience window. Inside a click this always
  // works; on load it only works once the user allowed pop-ups for the site.
  const openAudience = () => {
    if (s.mode === 'rehearse') return;
    if (audienceWin && !audienceWin.closed) { try { audienceWin.focus(); } catch (e) { /* ignore */ } return; }
    if (audienceAlive) { post(deckId, 'presentation:audience-control', { type: 'focus' }); return; }
    const { bounds } = audienceTarget();
    const params = new URLSearchParams({ deckId });
    if (s.mode === 'projector') params.set('display', 'projector');
    const win = window.open(`/present/audience?${params}`, `mtd-audience-${deckId}`, features(bounds));
    if (!win) {
      blocked = true;
      emitInfo();
      return;
    }
    blocked = false;
    audienceWin = win;
    // Back on top: the audience window opens behind presenter view, ready to
    // share (desktop's showInactive), except on a projector.
    if (s.mode !== 'projector') setTimeout(() => { try { window.focus(); } catch (e) { /* ignore */ } }, 300);
    emitInfo();
  };

  const swapDisplays = () => {
    if (s.mode !== 'projector' || !screenDetails) return;
    const ext = externalScreen();
    if (!ext) return;
    const home = presenterScreen();
    try {
      const area = areaOf(ext);
      window.moveTo(area.left, area.top);
      window.resizeTo(area.width, area.height);
    } catch (e) { /* ignore */ }
    if (audienceWin && !audienceWin.closed && home) {
      try {
        const area = areaOf(home);
        audienceWin.moveTo(area.left, area.top);
        audienceWin.resizeTo(area.width, area.height);
      } catch (e) { /* ignore */ }
      post(deckId, 'presentation:audience-control', { type: 'want-fullscreen', mode: s.mode });
    }
    broadcast();
  };

  // ---- Lifecycle -------------------------------------------------------------

  const acquireWakeLock = async () => {
    try {
      if (!ended && document.visibilityState === 'visible' && navigator.wakeLock) {
        wakeLock = await navigator.wakeLock.request('screen');
      }
    } catch (e) { wakeLock = null; }
  };
  const onVisibility = () => { if (document.visibilityState === 'visible') acquireWakeLock(); };

  const end = () => {
    if (ended || ending) return;
    ending = true;
    foldCurrentSlideTime();
    const lastIndex = s.index;
    ended = true;
    try { wakeLock?.release(); } catch (e) { /* ignore */ }
    document.removeEventListener('visibilitychange', onVisibility);
    post(deckId, 'presentation:end-window', {});
    if (audienceWin && !audienceWin.closed) { try { audienceWin.close(); } catch (e) { /* ignore */ } }
    post(deckId, 'presentation:ended', { deckId, index: lastIndex });
    try { window.opener?.focus(); } catch (e) { /* ignore */ }
    window.close();
  };

  const goto = (index) => {
    if (!s.loaded) return;
    const next = Math.max(0, Math.min(index, s.slideIds.length - 1));
    if (next === s.index) return;
    foldCurrentSlideTime();
    s.index = next;
    s.slideEnteredAt = s.timer.runningSince ? now() : null;
    broadcast();
  };

  const setScreen = (value) => {
    if (!['normal', 'black', 'white'].includes(value)) return;
    s.screen = value;
    broadcast();
  };

  const setTimer = (action) => {
    const t = s.timer;
    if (action === 'pause' && t.runningSince) {
      foldCurrentSlideTime();
      t.accumulated += now() - t.runningSince;
      t.runningSince = null;
      s.slideEnteredAt = null;
    } else if (action === 'resume' && !t.runningSince) {
      t.runningSince = now();
      s.slideEnteredAt = now();
    } else if (action === 'reset') {
      t.accumulated = 0;
      s.slideTimes = {};
      if (t.runningSince) { t.runningSince = now(); s.slideEnteredAt = now(); }
    }
    broadcast();
  };

  const loadDeck = async () => {
    const { getSlideDeck } = await import('@/lib/slidesApi');
    const res = await getSlideDeck(deckId);
    const outline = res?.success ? res.deck?.outline : null;
    if (!outline?.slides?.length) return null;
    return { title: outline.title || res.deck.title || 'Slide deck', slideIds: outline.slides.map((sl) => sl.id) };
  };

  // Re-reads slide ids/title after the deck was edited mid-presentation
  // (reorder, duplicate, delete...), keeping the presenter on the same slide.
  const refreshDeck = async () => {
    const deck = await loadDeck();
    if (!deck || ended) return;
    const currentId = currentSlideId();
    foldCurrentSlideTime();
    s.slideIds = deck.slideIds;
    s.title = deck.title;
    const found = deck.slideIds.indexOf(currentId);
    s.index = found >= 0 ? found : Math.min(s.index, deck.slideIds.length - 1);
    emitLocal('deckChanged', { deckId });
    post(deckId, 'presentation:deck-changed', { deckId });
    broadcast();
  };

  const init = async () => {
    const deck = await loadDeck();
    if (!deck) { resolveReady(); return; }
    s.title = deck.title;
    s.slideIds = deck.slideIds;
    s.index = Number.isInteger(startIndex) ? Math.max(0, Math.min(startIndex, deck.slideIds.length - 1)) : 0;
    s.loaded = true;
    document.title = `MTD — Presenter view: ${deck.title}`;

    screenDetails = await grantedScreenDetails();
    if (screenDetails) {
      screenDetails.addEventListener('screenschange', onScreensChanged);
      if (s.mode !== 'rehearse' && externalScreen()) s.mode = 'projector';
    }
    acquireWakeLock();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', end);
    resolveReady();
    broadcast();
    openAudience();
  };
  init();

  return {
    deckId,
    ready,
    publicState,
    broadcast,
    goto,
    setScreen,
    setTimer,
    swapDisplays,
    refreshDeck,
    end,
    info,
    onInfo: (cb) => { infoListeners.add(cb); return () => infoListeners.delete(cb); },
    // "Open the audience window" / "Show": a click in presenter view. If the
    // site may manage windows but hasn't been asked yet, ask now — it puts
    // the audience view on the second screen like desktop's projector mode.
    showAudience: () => {
      const hadWindow = audienceWin && !audienceWin.closed;
      openAudience();
      if (hadWindow || !('getScreenDetails' in window) || screenDetails || !window.screen.isExtended) return;
      window.getScreenDetails().then((details) => {
        screenDetails = details;
        details.addEventListener('screenschange', onScreensChanged);
        if (s.mode !== 'rehearse' && externalScreen()) {
          s.mode = 'projector';
          placeAudience();
          broadcast();
        }
        emitInfo();
      }).catch(() => {});
    },
    audienceHello: () => {
      audienceAlive = true;
      emitInfo();
      broadcast();
      if (s.mode === 'projector') post(deckId, 'presentation:audience-control', { type: 'want-fullscreen', mode: s.mode });
    },
    // Closing the audience window ends the show, as on desktop.
    audienceBye: () => {
      audienceAlive = false;
      end();
    },
  };
}
