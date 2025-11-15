import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

const LoadingSpinner = ({ 
  size = "default", 
  className,
  color = "primary",
  ...props 
}) => {
  const sizeClasses = {
    sm: "h-4 w-4",
    default: "h-6 w-6",
    lg: "h-8 w-8",
    xl: "h-12 w-12"
  };

  const colorClasses = {
    primary: "border-primary-600",
    secondary: "border-gray-600",
    white: "border-white",
    success: "border-success-600",
    warning: "border-warning-600",
    error: "border-error-600"
  };

  return (
    <motion.div
      className={cn(
        "animate-spin rounded-full border-2 border-t-transparent",
        sizeClasses[size],
        colorClasses[color],
        className
      )}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      {...props}
    />
  );
};

const LoadingDots = ({ className, color = "primary" }) => {
  const colorClasses = {
    primary: "bg-primary-600",
    secondary: "bg-gray-600",
    white: "bg-white",
    success: "bg-success-600",
    warning: "bg-warning-600",
    error: "bg-error-600"
  };

  return (
    <div className={cn("flex space-x-1", className)}>
      {[0, 1, 2].map((index) => (
        <motion.div
          key={index}
          className={cn("h-2 w-2 rounded-full", colorClasses[color])}
          animate={{
            scale: [1, 1.2, 1],
            opacity: [0.7, 1, 0.7],
          }}
          transition={{
            duration: 0.8,
            repeat: Infinity,
            delay: index * 0.2,
          }}
        />
      ))}
    </div>
  );
};

const LoadingPulse = ({ className, color = "primary" }) => {
  const colorClasses = {
    primary: "bg-primary-600",
    secondary: "bg-gray-600",
    white: "bg-white",
    success: "bg-success-600",
    warning: "bg-warning-600",
    error: "bg-error-600"
  };

  return (
    <motion.div
      className={cn("h-4 w-4 rounded-full", colorClasses[color], className)}
      animate={{
        scale: [1, 1.5, 1],
        opacity: [1, 0.5, 1],
      }}
      transition={{
        duration: 1,
        repeat: Infinity,
      }}
    />
  );
};

const LoadingSkeleton = ({ className, ...props }) => {
  return (
    <motion.div
      className={cn(
        "animate-pulse rounded-md bg-gray-200 dark:bg-gray-800",
        className
      )}
      initial={{ opacity: 0.6 }}
      animate={{ opacity: [0.6, 1, 0.6] }}
      transition={{
        duration: 1.5,
        repeat: Infinity,
        ease: "easeInOut",
      }}
      {...props}
    />
  );
};

export { LoadingSpinner, LoadingDots, LoadingPulse, LoadingSkeleton };
