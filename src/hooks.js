import { useState, useEffect, useRef, useCallback } from "react";

function readStoredValue(key, fallback) {
  try { const s = localStorage.getItem(key); return s ? JSON.parse(s) : fallback; }
  catch { return fallback; }
}

export function useLocalStorageState(key, fallback) {
  const [value, setValue] = useState(() => readStoredValue(key, fallback));
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} }, [key, value]);
  return [value, setValue];
}

export function useFocusTrap(active = true) {
  const ref = useRef(null);

  const handleKeyDown = useCallback((e) => {
    if (e.key !== "Tab" || !ref.current) return;
    const focusable = ref.current.querySelectorAll(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey) {
      if (document.activeElement === first) { e.preventDefault(); last.focus(); }
    } else {
      if (document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    document.addEventListener("keydown", handleKeyDown);
    // Auto-focus the first focusable element
    if (ref.current) {
      const first = ref.current.querySelector(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (first) first.focus();
    }
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [active, handleKeyDown]);

  return ref;
}
