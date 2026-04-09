import { useEffect } from "react";
import type { RefObject } from "react";

interface UseFocusManagementOptions {
  focusTarget: RefObject<HTMLElement | null>;
  shouldFocus: boolean;
}

export function useFocusManagement({ focusTarget, shouldFocus }: UseFocusManagementOptions) {
  useEffect(() => {
    if (!shouldFocus || typeof document === "undefined") return;

    const target = focusTarget.current;
    if (!target) return;
    if (target instanceof HTMLButtonElement && target.disabled) return;

    const active = document.activeElement;
    if (active && (target === active || target.contains(active))) {
      return;
    }

    try {
      target.focus({ preventScroll: true });
    } catch {
      target.focus();
    }
  }, [focusTarget, shouldFocus]);
}
