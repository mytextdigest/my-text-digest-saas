"use client";
import { forwardRef, useContext, useState } from "react";
import { Download, Printer, MoreVertical, ExternalLink, Minus, Plus, MoveHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  ViewerToolbar, ToolbarButton, ToolbarDivider, ToolbarSpacer, ToolbarMenu,
  useDocumentFileActions, ViewerError, ViewerToolbarHost,
} from "./ViewerToolbar";

// Frame + toolbar for the non-PDF viewers (image, DOCX, text, spreadsheet).
// zoom: optional { value, onIn, onOut, onFit, isFit, canIn, canOut }.
// onPrint: optional async () => { success, error? }.
const FileViewerFrame = forwardRef(function FileViewerFrame(
  { docId, fileUrl, zoom, onPrint, toolbarExtra, header, footer, children, onScroll, contentClassName },
  ref
) {
  const files = useDocumentFileActions(docId, fileUrl);
  const [printing, setPrinting] = useState(false);
  // Inside a page that hosts the toolbar in its header, drop the frame too.
  const framed = !useContext(ViewerToolbarHost);

  const handlePrint = async () => {
    setPrinting(true);
    try {
      const res = await onPrint();
      if (res && !res.success) files.setError(res.error);
    } catch (err) {
      files.setError(err.message || "Could not print.");
    } finally {
      setPrinting(false);
    }
  };

  return (
    <div className={cn(
      "relative w-full h-full flex flex-col overflow-hidden bg-white dark:bg-gray-900",
      framed && "rounded-lg border border-gray-200 dark:border-gray-700"
    )}>
      <ViewerToolbar>
        {zoom && (
          <>
            <ToolbarButton icon={Minus} label="Zoom out" onClick={zoom.onOut} disabled={!zoom.canOut} />
            <span className="shrink-0 w-12 text-center text-sm tabular-nums text-gray-600 dark:text-gray-300">
              {Math.round(zoom.value * 100)}%
            </span>
            <ToolbarButton icon={Plus} label="Zoom in" onClick={zoom.onIn} disabled={!zoom.canIn} />
            <ToolbarDivider collapse="md" />
            <ToolbarButton icon={MoveHorizontal} label="Fit to view" onClick={zoom.onFit} active={zoom.isFit} collapse="md" />
          </>
        )}
        {toolbarExtra}
        <ToolbarSpacer />
        <ToolbarButton icon={Download} label="Download" onClick={files.download} collapse="md" />
        {onPrint && <ToolbarButton icon={Printer} label={printing ? "Preparing to print…" : "Print"} onClick={handlePrint} busy={printing} collapse="md" />}
        <ToolbarMenu
          icon={MoreVertical}
          label="More"
          items={[
            ...(zoom ? [{ label: "Fit to view", icon: MoveHorizontal, onClick: zoom.onFit, active: zoom.isFit, collapse: "md" }] : []),
            { label: "Download", icon: Download, onClick: files.download, collapse: "md" },
            ...(onPrint ? [{ label: "Print", icon: Printer, onClick: handlePrint, disabled: printing, collapse: "md" }] : []),
            { divider: true, collapse: "md" },
            { label: "Open in new tab", icon: ExternalLink, onClick: files.openExternally },
          ]}
        />
      </ViewerToolbar>
      {header}
      <div ref={ref} onScroll={onScroll} className={cn("flex-1 min-h-0 overflow-auto custom-scrollbar", contentClassName)}>
        {children}
      </div>
      {footer}
      <ViewerError message={files.error} />
    </div>
  );
});

export default FileViewerFrame;
