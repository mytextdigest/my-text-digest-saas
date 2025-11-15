import { forwardRef } from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

const Input = forwardRef(({ 
  className, 
  type = "text",
  error,
  label,
  helperText,
  leftIcon,
  rightIcon,
  ...props 
}, ref) => {
  return (
    <div className="w-full">
      {label && (
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          {label}
        </label>
      )}
      
      <div className="relative">
        {leftIcon && (
          <div className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400">
            {leftIcon}
          </div>
        )}
        
        <motion.input
          type={type}
          className={cn(
            "flex h-10 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm",
            "placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-600 focus:border-transparent",
            "disabled:cursor-not-allowed disabled:opacity-50",
            "dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:placeholder:text-gray-400",
            leftIcon && "pl-10",
            rightIcon && "pr-10",
            error && "border-error-500 focus:ring-error-500",
            className
          )}
          ref={ref}
          whileFocus={{ scale: 1.01 }}
          transition={{ type: "spring", stiffness: 300, damping: 30 }}
          {...props}
        />
        
        {rightIcon && (
          <div className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400">
            {rightIcon}
          </div>
        )}
      </div>
      
      {(error || helperText) && (
        <motion.p
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className={cn(
            "mt-2 text-sm",
            error ? "text-error-600" : "text-gray-600 dark:text-gray-400"
          )}
        >
          {error || helperText}
        </motion.p>
      )}
    </div>
  );
});

Input.displayName = "Input";

const Textarea = forwardRef(({ 
  className, 
  error,
  label,
  helperText,
  rows = 3,
  ...props 
}, ref) => {
  return (
    <div className="w-full">
      {label && (
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          {label}
        </label>
      )}
      
      <motion.textarea
        rows={rows}
        className={cn(
          "flex min-h-[80px] w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm",
          "placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-600 focus:border-transparent",
          "disabled:cursor-not-allowed disabled:opacity-50 resize-none",
          "dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:placeholder:text-gray-400",
          error && "border-error-500 focus:ring-error-500",
          className
        )}
        ref={ref}
        whileFocus={{ scale: 1.01 }}
        transition={{ type: "spring", stiffness: 300, damping: 30 }}
        {...props}
      />
      
      {(error || helperText) && (
        <motion.p
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className={cn(
            "mt-2 text-sm",
            error ? "text-error-600" : "text-gray-600 dark:text-gray-400"
          )}
        >
          {error || helperText}
        </motion.p>
      )}
    </div>
  );
});

Textarea.displayName = "Textarea";

export { Input, Textarea };
