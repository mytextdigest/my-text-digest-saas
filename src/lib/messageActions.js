// Remove basic markdown symbols but keep readable text
export function stripMarkdown(md) {
    if (!md) return "";
  
    return md
      .replace(/```[\s\S]*?```/g, "")        // remove code blocks
      .replace(/`([^`]*)`/g, "$1")           // inline code
      .replace(/\*\*([^*]+)\*\*/g, "$1")     // bold
      .replace(/\*([^*]+)\*/g, "$1")         // italic
      .replace(/#+\s?/g, "")                 // headers
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // links
      .replace(/>\s?/g, "")                  // blockquote
      .trim();
  }
  
  export async function copyMessage(text) {
    try {
      await navigator.clipboard.writeText(stripMarkdown(text));
    } catch (err) {
      console.error("Copy failed:", err);
    }
  }
  
  export function printMessage(text) {
    const printWindow = window.open("", "_blank");
  
    printWindow.document.write(`
      <html>
        <head>
          <title>Print Message</title>
          <style>
            body {
              font-family: system-ui, sans-serif;
              padding: 24px;
              line-height: 1.6;
              white-space: pre-wrap;
            }
          </style>
        </head>
        <body>${text.replace(/\n/g, "<br/>")}</body>
      </html>
    `);
  
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  }
  