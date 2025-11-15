import { motion, AnimatePresence } from "framer-motion";
import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";

const ClearChatDialog = ({ open, onClose, onConfirm, className }) => {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          className={cn(
            "w-full max-w-md mx-auto bg-white dark:bg-gray-900 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6",
            className
          )}
        >
          <div className="flex flex-col items-center text-center space-y-4">
            {/* Icon */}
            <div className="w-16 h-16 bg-red-50 dark:bg-red-900/20 rounded-full flex items-center justify-center">
              <AlertCircle className="w-8 h-8 text-red-600 dark:text-red-400" />
            </div>

            {/* Title & description */}
            <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100">
              Clear Chat?
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              This will delete the current conversation history and start a new
              one. This action cannot be undone.
            </p>

            {/* Actions */}
            <div className="flex items-center justify-center space-x-3 pt-4">
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button variant="destructive" onClick={onConfirm}>
                Clear Chat
              </Button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default ClearChatDialog;
