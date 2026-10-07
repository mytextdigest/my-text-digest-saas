// src/lib/chatImagesApi.js
// Client shim with the same method names and return shapes as the desktop
// preload.js chat image API, so the chat image components (copied from the
// desktop) differ from it by their import line only. Each method calls the
// matching route and resolves to `{ success, ... }` like the IPC handler did.
//
// Differences that the platform forces:
// - Uploads go browser → S3 (presigned POST), then are registered.
// - improveChatImage enqueues a worker job and polls it, resolving only
//   when the redraw is done — like the desktop's single IPC call.
// - saveImageAs is a browser download, copyImageToClipboard the Clipboard API.

const POLL_INTERVAL_MS = 1500;

const enc = encodeURIComponent;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function call(url, { method = "GET", body } = {}) {
  try {
    const res = await fetch(url, {
      method,
      credentials: "include",
      headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok && data.success === undefined) return { success: false, error: data.error || `Request failed (${res.status})` };
    if (!res.ok) return { ...data, success: false };
    return data;
  } catch (err) {
    return { success: false, error: err.message || "Network error" };
  }
}

// requestId → { kind, messageId, cancelled } for running redraws.
const improveJobs = new Map();

function cancelJob(kind, messageId) {
  return call(`/api/chat-images/jobs/${enc(messageId)}/cancel?kind=${enc(kind)}`, { method: "POST" });
}

async function uploadChatAttachment({ messageTable: kind, filename, file }) {
  try {
    const presign = await call("/api/chat-attachments/presign", {
      method: "POST",
      body: { kind, fileName: filename, fileType: file.type },
    });
    if (!presign?.success) return { success: false, error: presign?.error || "Upload failed" };

    const form = new FormData();
    Object.entries(presign.fields).forEach(([k, v]) => form.append(k, v));
    form.append("file", file);
    const upload = await fetch(presign.url, { method: "POST", body: form });
    if (!upload.ok) {
      return { success: false, error: file.size > 20 * 1024 * 1024 ? "Images must be under 20MB." : "Upload failed" };
    }

    return await call("/api/chat-attachments", {
      method: "POST",
      body: { key: presign.key, kind, originalName: filename },
    });
  } catch (err) {
    return { success: false, error: "Could not read that image." };
  }
}

async function improveChatImage({ attachmentId, quality, requestId = null }) {
  const job = { kind: null, messageId: null, cancelled: false };
  if (requestId) improveJobs.set(requestId, job);
  try {
    const res = await call(`/api/chat-attachments/${enc(attachmentId)}/improve`, { method: "POST", body: { quality } });
    if (!res?.success) return { success: false, error: res?.error || "Could not redraw the image." };
    Object.assign(job, res.pending);
    // Stop pressed before the job existed.
    if (job.cancelled) {
      await cancelJob(job.kind, job.messageId);
      return { success: false, cancelled: true };
    }

    while (true) {
      await sleep(POLL_INTERVAL_MS);
      if (job.cancelled) return { success: false, cancelled: true };
      const status = await call(`/api/chat-images/jobs/${enc(job.messageId)}?kind=${enc(job.kind)}`);
      if (job.cancelled) return { success: false, cancelled: true };
      if (!status?.status) {
        // Transient failure: keep polling; a missing message ends it.
        if (/not found/i.test(status?.error || "")) return { success: false, error: "Could not redraw the image." };
        continue;
      }
      if (status.status === "generating") continue;
      if (status.status === "done") return { success: true, answer: status.answer, attachments: status.attachments || [] };
      if (status.status === "cancelled") return { success: false, cancelled: true };
      return { success: false, error: status.error || "Could not redraw the image." };
    }
  } finally {
    if (requestId) improveJobs.delete(requestId);
  }
}

async function cancelRequest(requestId) {
  const job = improveJobs.get(requestId);
  if (job) {
    job.cancelled = true;
    if (job.messageId) await cancelJob(job.kind, job.messageId);
    return { success: true, cancelled: true };
  }
  return call("/api/cancel", { method: "POST", body: { requestId } });
}

function clickDownload(href, filename) {
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

async function saveImageAs({ fileUrl, defaultName }) {
  const name = String(defaultName || "image.png").replace(/[\\/:*?"<>|]/g, "-");
  try {
    // Chat images: the file route serves the download itself.
    if (String(fileUrl).startsWith("/api/chat-attachments/")) {
      clickDownload(`${fileUrl}?download=1&name=${enc(name)}`, name);
      return { success: true };
    }
    const res = await fetch(fileUrl);
    if (!res.ok) return { success: false, error: "Could not save the image." };
    const href = URL.createObjectURL(await res.blob());
    clickDownload(href, name);
    setTimeout(() => URL.revokeObjectURL(href), 1000);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message || "Could not save the image." };
  }
}

async function toPngBlob(blob) {
  if (blob.type === "image/png") return blob;
  const bitmap = await createImageBitmap(blob);
  try {
    if (typeof OffscreenCanvas !== "undefined") {
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      canvas.getContext("2d").drawImage(bitmap, 0, 0);
      return await canvas.convertToBlob({ type: "image/png" });
    }
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext("2d").drawImage(bitmap, 0, 0);
    return await new Promise((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not read the image."))), "image/png"));
  } finally {
    bitmap.close?.();
  }
}

async function copyImageToClipboard({ fileUrl }) {
  try {
    if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
      return { success: false, error: "Copying images isn't supported in this browser." };
    }
    // The item takes a promise so the write starts inside the click (Safari
    // rejects a clipboard write that comes after an await).
    const png = fetch(fileUrl).then((res) => {
      if (!res.ok) throw new Error("Could not read the image.");
      return res.blob();
    }).then(toPngBlob);
    await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message || "Could not copy the image." };
  }
}

const chatImagesApi = {
  uploadChatAttachment,
  discardChatAttachment: (id) => call(`/api/chat-attachments/${enc(id)}`, { method: "DELETE" }),
  saveChatAttachmentToProject: ({ attachmentId, projectId }) =>
    call(`/api/chat-attachments/${enc(attachmentId)}/save-to-project`, { method: "POST", body: { projectId } }),
  improveChatImage,
  saveImageAs,
  copyImageToClipboard,
  cancelRequest,
};

export default chatImagesApi;
