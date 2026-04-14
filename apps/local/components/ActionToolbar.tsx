import React, { forwardRef } from 'react';
import { useInputCapabilities } from "@/hooks/useInputCapabilities";

export interface ActionToolbarProps extends React.HTMLAttributes<HTMLDivElement> {
  // A wrapper for group-hover revealed actions
}

export const ActionToolbar = forwardRef<HTMLDivElement, ActionToolbarProps>(
  ({ children, className = '', ...props }, ref) => {
    const { isTouchLayout } = useInputCapabilities();
    const visibilityClasses = isTouchLayout ? "opacity-100" : "opacity-0 group-hover:opacity-100";
    const baseClasses = `absolute top-4 right-4 flex items-center gap-1 ${visibilityClasses} transition-opacity duration-200 bg-[var(--app-shell-elevated)] border border-[var(--app-shell-border)] shadow-md rounded-lg p-1 z-10 backdrop-blur-sm`;

    const classes = `${baseClasses} ${className}`.trim();

    return (
      <div ref={ref} className={classes} data-touch-visible={isTouchLayout ? "true" : undefined} {...props}>
        {children}
      </div>
    );
  }
);

ActionToolbar.displayName = 'ActionToolbar';

export const ActionToolbarDivider = () => (
  <div className="w-px h-4 bg-[var(--app-shell-border)] mx-1" />
);
