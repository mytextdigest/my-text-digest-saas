'use client'

import { useState } from "react"
import { Copy, Printer, Maximize2, Check } from "lucide-react"
import { Button } from "@/components/ui/Button"
import { copyMessage, printMessage } from "@/lib/messageActions"
import { cn } from "@/lib/utils"

export default function MessageActions({
  content,
  onExpand,
  align = "left",
  showExpand = true,   // ⭐ NEW PROP
}) {
  const isUser = align === "right"
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    await copyMessage(content)
    setCopied(true)

    setTimeout(() => {
      setCopied(false)
    }, 2000)
  }

  return (
    <div
      className={cn(
        "flex items-center gap-1 mt-2",
        isUser ? "justify-end" : "justify-start"
      )}
    >
      {/* ===== TOOLBAR CONTAINER ===== */}
      <div
        className={cn(
          "flex items-center gap-1 px-2 py-1 rounded-lg shadow-sm",

          // 👤 USER (RIGHT)
          isUser
            ? `
              bg-blue-500/90
              text-white
              border border-blue-400/40
            `
            // 🤖 ASSISTANT (LEFT)
            : `
              bg-gray-100 dark:bg-gray-800
              text-gray-700 dark:text-gray-200
              border border-gray-200 dark:border-gray-700
            `
        )}
      >

        {/* COPY */}
        <Button
          size="icon"
          variant="ghost"
          onClick={handleCopy}
          title="Copy"
          className={cn(
            "h-7 w-7",
            isUser
              ? "text-white hover:bg-blue-400/60"
              : "text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700"
          )}
        >
          {copied ? (
            <Check className="w-4 h-4" />
          ) : (
            <Copy className="w-4 h-4" />
          )}
        </Button>

        {/* PRINT */}
        <Button
          size="icon"
          variant="ghost"
          onClick={() => printMessage(content)}
          title="Print"
          className={cn(
            "h-7 w-7",
            isUser
              ? "text-white hover:bg-blue-400/60"
              : "text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700"
          )}
        >
          <Printer className="w-4 h-4" />
        </Button>

        {/* EXPAND (OPTIONAL) */}
        {showExpand && (
          <Button
            size="icon"
            variant="ghost"
            onClick={onExpand}
            title="Expand Message"
            className={cn(
              "h-7 w-7",
              isUser
                ? "text-white hover:bg-blue-400/60"
                : "text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700"
            )}
          >
            <Maximize2 className="w-4 h-4" />
          </Button>
        )}

      </div>
    </div>
  )
}
