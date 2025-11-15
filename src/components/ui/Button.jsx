import { forwardRef } from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

const buttonVariants = {
  // Base styles
  base: "inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
  
  // Variants
  variants: {
    default: "bg-primary-600 text-white hover:bg-primary-700 active:bg-primary-800 shadow-sm hover:shadow-md",
    destructive: "bg-error-600 text-white hover:bg-error-700 active:bg-error-800 shadow-sm hover:shadow-md",
    outline: "border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 hover:border-gray-400 active:bg-gray-100 shadow-sm",
    secondary: "bg-secondary-100 text-secondary-900 hover:bg-secondary-200 active:bg-secondary-300",
    ghost: "text-gray-700 hover:bg-gray-100 active:bg-gray-200",
    link: "text-primary-600 underline-offset-4 hover:underline hover:text-primary-700",
    success: "bg-success-600 text-white hover:bg-success-700 active:bg-success-800 shadow-sm hover:shadow-md",
    warning: "bg-warning-600 text-white hover:bg-warning-700 active:bg-warning-800 shadow-sm hover:shadow-md",
  },
  
  // Sizes
  sizes: {
    sm: "h-8 px-3 text-xs",
    default: "h-10 px-4 py-2",
    lg: "h-12 px-6 text-base",
    xl: "h-14 px-8 text-lg",
    icon: "h-10 w-10",
  }
};

const Button = forwardRef(({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  loading = false,
  disabled = false,
  children,
  'aria-label': ariaLabel,
  ...props
}, ref) => {
  const isDisabled = disabled || loading;

  const buttonClasses = cn(
    buttonVariants.base,
    buttonVariants.variants[variant],
    buttonVariants.sizes[size],
    className
  );

  const buttonContent = (
    <>
      {loading && (
        <motion.div
          className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          aria-hidden="true"
        />
      )}
      {children}
    </>
  );

  return (
    <motion.button
      className={buttonClasses}
      ref={ref}
      disabled={isDisabled}
      aria-disabled={isDisabled}
      aria-label={ariaLabel || (loading ? 'Loading...' : undefined)}
      whileHover={!isDisabled ? { scale: 1.02 } : {}}
      whileTap={!isDisabled ? { scale: 0.98 } : {}}
      transition={{ type: "spring", stiffness: 400, damping: 17 }}
      {...props}
    >
      {buttonContent}
    </motion.button>
  );
});

Button.displayName = "Button";

export { Button, buttonVariants };
