'use client'

import { useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Bot, User, X, Sparkles } from "lucide-react"
import { Card, CardContent } from "@/components/ui/Card"
import MessageActions from "@/components/chat/MessageActions"
import { cn } from "@/lib/utils"

export default function ExpandedMessageModal({
  open,
  message,
  onClose
}) {
  // ⭐ Medium default for readability
  const [fontSize, setFontSize] = useState("md")

  if (!open || !message) return null

  const isUser = message.type === "user" || message.role === "user"

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">

          {/* ===== BACKDROP ===== */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          />

          {/* ===== BACKGROUND GLOW ===== */}
          <div className="absolute inset-0 pointer-events-none overflow-hidden">
            <div className="absolute top-0 left-0 w-96 h-96 bg-primary-500 opacity-10 rounded-full blur-3xl" />
            <div className="absolute bottom-0 right-0 w-96 h-96 bg-blue-500 opacity-10 rounded-full blur-3xl" />
          </div>

          {/* ===== MODAL ===== */}
          <motion.div
            initial={{ opacity: 0, y: 40, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 40, scale: 0.95 }}
            transition={{ duration: 0.25 }}
            className="relative z-10 w-full max-w-3xl"
          >

            <Card className="shadow-2xl border-0 bg-white/95 dark:bg-gray-900/95 backdrop-blur">

              {/* ===== HEADER ===== */}
              <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-gray-200 dark:border-gray-700">

                {/* LEFT SIDE — ICON + TITLE */}
                <div className="flex items-center gap-3">

                  <div
                    className={`w-10 h-10 rounded-xl flex items-center justify-center shadow-md
                    ${isUser
                      ? "bg-gradient-to-br from-blue-500 to-blue-600"
                      : "bg-gradient-to-br from-purple-500 to-purple-600"
                    }`}
                  >
                    {isUser ? (
                      <User className="w-5 h-5 text-white" />
                    ) : (
                      <Bot className="w-5 h-5 text-white" />
                    )}
                  </div>

                  <div>
                    <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                      {isUser ? "Your Message" : "Assistant Response"}
                    </h2>

                    {!isUser && (
                      <p className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
                        <Sparkles className="w-3 h-3" />
                        AI Generated
                      </p>
                    )}
                  </div>

                </div>

                {/* RIGHT SIDE — CONTROLS */}
                <div className="flex items-center gap-2">

                  {/* ===== TEXT SIZE DROPDOWN ===== */}
                  <div className="
                    flex items-center
                    px-2 py-1 rounded-lg
                    bg-gray-100 dark:bg-gray-800
                    border border-gray-200 dark:border-gray-700
                  ">
                    <label htmlFor="text-size" className="sr-only">
                      Text size
                    </label>

                    <select
                        id="text-size"
                        value={fontSize}
                        onChange={(e) => setFontSize(e.target.value)}
                        className="
                            text-sm
                            outline-none
                            cursor-pointer
                            rounded
                            px-1

                            bg-gray-100 text-gray-900
                            dark:bg-gray-800 dark:text-gray-100

                            border border-gray-300
                            dark:border-gray-600
                        "
                        title="Text size"
                        >
                        <option
                            value="sm"
                            className="bg-white text-gray-900 dark:bg-gray-800 dark:text-gray-100"
                        >
                            Small
                        </option>

                        <option
                            value="md"
                            className="bg-white text-gray-900 dark:bg-gray-800 dark:text-gray-100"
                        >
                            Medium
                        </option>

                        <option
                            value="lg"
                            className="bg-white text-gray-900 dark:bg-gray-800 dark:text-gray-100"
                        >
                            Large
                        </option>

                        <option
                            value="xl"
                            className="bg-white text-gray-900 dark:bg-gray-800 dark:text-gray-100"
                        >
                            Extra Large
                        </option>
                    </select>

                  </div>

                  {/* CLOSE BUTTON */}
                  <button
                    onClick={onClose}
                    className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition"
                    aria-label="Close"
                  >
                    <X className="w-5 h-5 text-gray-500" />
                  </button>

                </div>

              </div>

              {/* ===== ACTION BAR ===== */}
              <div className="flex justify-end px-6 pt-4">
                <MessageActions
                  content={message.content}
                  showExpand={false}
                />
              </div>

              {/* ===== MESSAGE CONTENT ===== */}
              <CardContent className="px-6 pb-6 pt-2">

                {/* Scroll container */}
                <div className="max-h-[60vh] overflow-y-auto pr-2">

                  <div
                    className={cn(
                      "whitespace-pre-wrap leading-relaxed text-gray-800 dark:text-gray-200",
                      {
                        "text-sm": fontSize === "sm",
                        "text-base": fontSize === "md",
                        "text-lg": fontSize === "lg",
                        "text-xl": fontSize === "xl",
                      }
                    )}
                  >
                    {message.content}
                  </div>

                </div>

              </CardContent>

            </Card>

          </motion.div>

        </div>
      )}
    </AnimatePresence>
  )
}
