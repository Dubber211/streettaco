import { useState, useEffect } from "react";

function readStoredValue(key, fallback) {
  try { const s = localStorage.getItem(key); return s ? JSON.parse(s) : fallback; }
  catch { return fallback; }
}

export function useLocalStorageState(key, fallback) {
  const [value, setValue] = useState(() => readStoredValue(key, fallback));
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} }, [key, value]);
  return [value, setValue];
}
