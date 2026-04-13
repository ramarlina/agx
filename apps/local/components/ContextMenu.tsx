"use client";

import React, { useEffect, useState, useRef, useCallback } from "react";

export interface ContextMenuItem {
  label: string;
  icon?: React.ReactNode;
  shortcut?: string;
  action: () => void;
  destructive?: boolean;
  divider?: boolean;
}

interface ContextMenuProps {
  items: ContextMenuItem[];
  children: React.ReactNode;
}

export function ContextMenu({ items, children }: ContextMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [focusIndex, setFocusIndex] = useState(-1);
  const menuRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    setIsOpen(false);
    setFocusIndex(-1);
  }, []);

  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        close();
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        close();
        return;
      }

      const actionItems = items.filter((item) => !item.divider);
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setFocusIndex((prev) => (prev + 1) % actionItems.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setFocusIndex((prev) => (prev - 1 + actionItems.length) % actionItems.length);
      } else if (e.key === "Enter" && focusIndex >= 0) {
        e.preventDefault();
        actionItems[focusIndex]?.action();
        close();
      }
    };

    document.addEventListener("pointerdown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, close, focusIndex, items]);

  // Reposition if menu would overflow viewport
  useEffect(() => {
    if (!isOpen || !menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    let { x, y } = position;
    if (rect.right > window.innerWidth - 8) x = window.innerWidth - rect.width - 8;
    if (rect.bottom > window.innerHeight - 8) y = window.innerHeight - rect.height - 8;
    if (x !== position.x || y !== position.y) setPosition({ x, y });
  }, [isOpen, position]);

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setPosition({ x: e.clientX, y: e.clientY });
    setFocusIndex(-1);
    setIsOpen(true);
  };

  let actionIndex = -1;

  return (
    <>
      <div onContextMenu={handleContextMenu} className="w-full h-full">
        {children}
      </div>

      {isOpen && (
        <div
          ref={menuRef}
          style={{ top: position.y, left: position.x }}
          className="context-menu"
        >
          {items.map((item, index) => {
            if (item.divider) {
              return <div key={index} className="context-menu__divider" />;
            }
            actionIndex++;
            const isFocused = actionIndex === focusIndex;
            return (
              <button
                key={index}
                onClick={() => {
                  item.action();
                  close();
                }}
                className={`context-menu__item ${item.destructive ? "context-menu__item--destructive" : ""} ${isFocused ? "context-menu__item--focused" : ""}`}
              >
                {item.icon && <span className="context-menu__icon">{item.icon}</span>}
                <span className="context-menu__label">{item.label}</span>
                {item.shortcut && <span className="context-menu__shortcut">{item.shortcut}</span>}
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}
