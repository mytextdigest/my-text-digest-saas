// Browser stand-ins for the desktop's print-html / print-images IPC calls.
// The HTML is written into a hidden iframe, which is printed once its images
// have loaded and removed when the print dialog closes. Both resolve to
// { success: true } or { success: false, error }, like the desktop handlers.

const escapeHtml = (t) => String(t || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

export function printHtml(html) {
  return new Promise((resolve) => {
    const iframe = document.createElement("iframe");
    iframe.setAttribute("aria-hidden", "true");
    iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
    document.body.appendChild(iframe);

    let removed = false;
    const remove = () => {
      if (removed) return;
      removed = true;
      iframe.remove();
    };

    try {
      const doc = iframe.contentWindow.document;
      doc.open();
      doc.write(html);
      doc.close();

      const images = Array.from(doc.images);
      Promise.all(images.map((img) => (img.complete ? null : new Promise((done) => {
        img.addEventListener("load", done, { once: true });
        img.addEventListener("error", done, { once: true });
      })))).then(() => {
        const win = iframe.contentWindow;
        // afterprint fires when the dialog closes (printed or cancelled); the
        // timeout is a fallback for browsers where print() doesn't block.
        win.addEventListener("afterprint", () => setTimeout(remove, 0), { once: true });
        setTimeout(remove, 60_000);
        win.focus();
        win.print();
        resolve({ success: true });
      });
    } catch (err) {
      remove();
      resolve({ success: false, error: err.message || "Could not print." });
    }
  });
}

// Prints a list of image URLs (data: URLs or http(s) URLs), one per sheet.
// Same document as the desktop's print-images handler.
export function printImages(srcs, title) {
  if (!Array.isArray(srcs) || !srcs.length) return Promise.resolve({ success: false, error: "Nothing to print." });
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${escapeHtml(title)}</title><style>
    @page { margin: 0; }
    html, body { margin: 0; padding: 0; }
    img { display: block; width: 100%; height: auto; page-break-after: always; break-after: page; }
    img:last-child { page-break-after: auto; break-after: auto; }
  </style></head><body>${srcs.map((s) => `<img src="${escapeHtml(s)}">`).join("")}</body></html>`;
  return printHtml(html);
}
