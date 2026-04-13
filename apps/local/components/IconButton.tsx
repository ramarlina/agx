import React, { forwardRef } from 'react';
import { useInputCapabilities } from "@/hooks/useInputCapabilities";

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'neutral' | 'primary' | 'destructive' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ className = '', variant = 'neutral', size = 'md', children, ...props }, ref) => {
    const { isTouchLayout } = useInputCapabilities();
    const baseClasses = "inline-flex items-center justify-center rounded-md transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:opacity-50 disabled:pointer-events-none";

    const sizeClasses = {
      sm: "p-1 w-6 h-6",
      md: "p-1.5 w-8 h-8",
      lg: "p-2 w-10 h-10"
    };
    const touchSizeClasses = {
      sm: "h-11 w-11 p-2",
      md: "h-11 w-11 p-2",
      lg: "h-12 w-12 p-2.5",
    };

    const variantClasses = {
      neutral: "text-[var(--app-shell-muted)] hover:text-[var(--foreground)] hover:bg-[var(--app-shell-subtle)]",
      ghost: "text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)]",
      primary: "text-[var(--primary)] hover:text-[var(--primary-foreground)] hover:bg-[var(--primary-hover)]",
      destructive: "text-[var(--app-shell-muted)] hover:text-[var(--destructive)] hover:bg-[var(--destructive-muted)]"
    };

    const effectiveSizeClasses = isTouchLayout ? touchSizeClasses[size] : sizeClasses[size];
    const classes = `${baseClasses} ${effectiveSizeClasses} ${variantClasses[variant]} ${className}`.trim();

    return (
      <button ref={ref} className={classes} data-touch-target={isTouchLayout ? "true" : undefined} {...props}>
        {children}
      </button>
    );
  }
);

IconButton.displayName = 'IconButton';
