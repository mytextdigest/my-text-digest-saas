'use client'

import { useState } from "react"
import { Copy, Printer, Maximize2, Check } from "lucide-react"
import { copyMessage, printMessage } from "@/lib/messageActions"
import { cn } from "@/lib/utils"

function ActionButton({ title, onClick, children }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className="h-7 w-7 inline-flex items-center justify-center rounded-md text-gray-500 hover:text-gray-900 hover:bg-gray-100 dark:text-gray-400 dark:hover:text-gray-100 dark:hover:bg-gray-700 transition-colors"
    >
      {children}
    </button>
  )
}

// Copy / print / expand toolbar under a chat message. `trailing` renders on the
// far right of the row (e.g. answer feedback); `className` lets callers hide it
// until hover.
export default function MessageActions({
  content,
  onExpand,
  align = "left",
  showExpand = true,
  trailing,
  className,
}) {
  const isUser = align === "right"
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    await copyMessage(content)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div
      className={cn(
        "flex items-center gap-2 mt-2",
        isUser ? "justify-end" : "justify-between w-full",
        className
      )}
    >
      <div className="flex items-center gap-0.5 p-0.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
        <ActionButton title={copied ? "Copied" : "Copy"} onClick={handleCopy}>
          {copied ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
        </ActionButton>
        <ActionButton title="Print" onClick={() => printMessage(content)}>
          <Printer className="w-4 h-4" />
        </ActionButton>
        {showExpand && (
          <ActionButton title="Expand message" onClick={onExpand}>
            <Maximize2 className="w-4 h-4" />
          </ActionButton>
        )}
      </div>
      {trailing}
    </div>
  )
}
