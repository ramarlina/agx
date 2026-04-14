"use client";

import { useEffect, useState } from "react";

const COARSE_POINTER_QUERY = "(pointer: coarse)";
const HOVER_QUERY = "(hover: hover)";
const PHONE_QUERY = "(max-width: 767px)";
const TABLET_QUERY = "(min-width: 768px)";

type InputCapabilities = {
  isCoarsePointer: boolean;
  canHover: boolean;
  isPhone: boolean;
  isTablet: boolean;
  isTouchLayout: boolean;
};

function readCapabilities(): InputCapabilities {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return {
      isCoarsePointer: false,
      canHover: true,
      isPhone: false,
      isTablet: false,
      isTouchLayout: false,
    };
  }

  const isCoarsePointer = window.matchMedia(COARSE_POINTER_QUERY).matches;
  const canHover = window.matchMedia(HOVER_QUERY).matches;
  const isPhone = window.matchMedia(PHONE_QUERY).matches;
  const isTablet = !isPhone && window.matchMedia(TABLET_QUERY).matches;
  const isTouchLayout = isCoarsePointer || !canHover;

  return {
    isCoarsePointer,
    canHover,
    isPhone: isTouchLayout && isPhone,
    isTablet: isTouchLayout && isTablet,
    isTouchLayout,
  };
}

export function useInputCapabilities(): InputCapabilities {
  const [capabilities, setCapabilities] = useState<InputCapabilities>(readCapabilities);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }

    const mediaQueries = [
      window.matchMedia(COARSE_POINTER_QUERY),
      window.matchMedia(HOVER_QUERY),
      window.matchMedia(PHONE_QUERY),
      window.matchMedia(TABLET_QUERY),
    ];

    const updateCapabilities = () => {
      setCapabilities(readCapabilities());
    };

    mediaQueries.forEach((query) => query.addEventListener("change", updateCapabilities));
    window.addEventListener("resize", updateCapabilities);
    updateCapabilities();

    return () => {
      mediaQueries.forEach((query) => query.removeEventListener("change", updateCapabilities));
      window.removeEventListener("resize", updateCapabilities);
    };
  }, []);

  return capabilities;
}
