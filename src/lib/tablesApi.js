// src/lib/tablesApi.js
// Client shim with the same method names and return shapes as the desktop
// preload.js table API, so the Tables components (copied from the desktop)
// differ from it by their import line only. Each method calls the matching
// route and resolves to `{ success, ... }` like the IPC handler did.
//
// Differences that the platform forces:
// - Exports download the file instead of opening a save dialog.
// - copyTable writes to the clipboard here, in the browser.
// - onTableExtractionUpdate(docId, cb) polls instead of listening for IPC
//   events (see below).

const POLL_INTERVAL_MS = 3000; // matches FiguresGallery's POLL_INTERVAL_MS

async function call(url, { method = "GET", body } = {}) {
  try {
    const res = await fetch(url, {
      method,
      headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok && data.success === undefined) return { success: false, error: data.error || `Request failed (${res.status})` };
    return data;
  } catch (err) {
    return { success: false, error: err.message || "Network error" };
  }
}

// Fetches a file from a route and hands it to the browser as a download.
async function download(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return { success: false, error: data.error || `Export failed (${res.status})` };
    }
    const blob = await res.blob();
    const disposition = res.headers.get("Content-Disposition") || "";
    const match = /filename\*=UTF-8''([^;]+)|filename="([^"]+)"/i.exec(disposition);
    const filename = match ? decodeURIComponent(match[1] || match[2]) : "table";
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
    return { success: true, filePath: filename };
  } catch (err) {
    return { success: false, error: err.message || "Export failed" };
  }
}

const enc = encodeURIComponent;

// --- Extraction progress polling (replaces the "table-extraction-update"
// IPC event). One poller per document, shared by its subscribers. It polls
// the list route while the log is running or has vision progress, stops
// otherwise, and is restarted by extractTables/extractScannedTables. Emits
// the desktop payload shape { docId, status, tablesFound, done, total } on
// changes only.
const pollers = new Map(); // docId → { subs:Set, timer, last }

function payloadFrom(docId, res) {
  const log = res?.log;
  if (!log) return null;
  const progress = log.vision_json?.progress;
  if (progress) return { docId, status: "reading-images", done: progress.done, total: progress.total, tablesFound: log.tables_found };
  const status = log.status === "running" ? "extracting" : log.status === "ready" ? "tables-ready" : log.status;
  return { docId, status, tablesFound: log.tables_found };
}

function isActive(res) {
  return res?.log?.status === "running" || !!res?.log?.vision_json?.progress;
}

async function tick(docId) {
  const p = pollers.get(docId);
  if (!p) return;
  p.timer = null;
  const res = await call(`/api/documents/${enc(docId)}/tables`);
  if (!pollers.has(docId)) return;
  if (res?.success) {
    const payload = payloadFrom(docId, res);
    const key = JSON.stringify(payload);
    if (payload && key !== p.last) {
      const first = p.last === undefined;
      p.last = key;
      // The first snapshot is what the subscriber just loaded itself.
      if (!first) p.subs.forEach((cb) => cb(payload));
    }
  }
  if (isActive(res) || p.kicked > 0) {
    if (p.kicked > 0) p.kicked--;
    p.timer = setTimeout(() => tick(docId), POLL_INTERVAL_MS);
  }
}

function kick(docId) {
  const p = pollers.get(docId);
  if (!p) return;
  // A job was just queued; poll a few times even before the worker marks
  // the log running.
  p.kicked = 3;
  if (!p.timer) p.timer = setTimeout(() => tick(docId), POLL_INTERVAL_MS);
}

function onTableExtractionUpdate(docId, callback) {
  // Desktop-style global subscription (no document): nothing to poll.
  if (typeof docId === "function" || docId == null) return () => {};
  let p = pollers.get(docId);
  if (!p) {
    p = { subs: new Set(), timer: null, last: undefined, kicked: 0 };
    pollers.set(docId, p);
    tick(docId);
  }
  p.subs.add(callback);
  return () => {
    p.subs.delete(callback);
    if (!p.subs.size) {
      clearTimeout(p.timer);
      pollers.delete(docId);
    }
  };
}

const tablesApi = {
  listTables: (documentId) => call(`/api/documents/${enc(documentId)}/tables`),
  listProjectTables: (projectId, query = "") => call(`/api/projects/${enc(projectId)}/tables?q=${enc(query)}`),
  getTable: (tableId) => call(`/api/tables/${enc(tableId)}`),
  updateTable: (tableId, patch) => call(`/api/tables/${enc(tableId)}`, { method: "PATCH", body: patch || {} }),
  applyTableAction: (tableId, action, args) => call(`/api/tables/${enc(tableId)}/action`, { method: "POST", body: { action, args: args || {} } }),
  resetTable: (tableId) => call(`/api/tables/${enc(tableId)}/reset`, { method: "POST" }),
  deleteTable: (tableId) => call(`/api/tables/${enc(tableId)}`, { method: "DELETE" }),
  extractTables: async (documentId) => {
    const res = await call(`/api/documents/${enc(documentId)}/tables/extract`, { method: "POST" });
    if (res?.success) kick(documentId);
    return res;
  },
  extractScannedTables: async (documentId) => {
    const res = await call(`/api/documents/${enc(documentId)}/tables/extract-scanned`, { method: "POST" });
    if (res?.success) kick(documentId);
    return res;
  },
  exportTable: (tableId, format = "xlsx") => download(`/api/tables/${enc(tableId)}/export?format=${enc(format)}`),
  exportAllTables: (documentId) => download(`/api/documents/${enc(documentId)}/tables/export`),
  exportDerivedTable: (derivedTableId, format = "xlsx") => download(`/api/derived-tables/${enc(derivedTableId)}/export?format=${enc(format)}`),
  copyTable: async (tableId) => {
    try {
      const res = await fetch(`/api/tables/${enc(tableId)}/tsv`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        return { success: false, error: data.error || "Table not found" };
      }
      await navigator.clipboard.writeText(await res.text());
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },
  getTableStats: (tableId) => call(`/api/tables/${enc(tableId)}/stats`),
  getDerivedTable: (id) => call(`/api/derived-tables/${enc(id)}`),
  compareTables: (projectId, tableIds, periods) =>
    call(`/api/projects/${enc(projectId)}/tables/compare`, { method: "POST", body: { tableIds, periods } }),
  onTableExtractionUpdate,
};

export default tablesApi;
