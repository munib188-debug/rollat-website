import { useState, useEffect } from "react";

export function useCountdown(targetDate) {
  const calc = () => {
    if (!targetDate) return { d: 0, h: 0, m: 0, s: 0, total: 0 };
    const total = new Date(targetDate).getTime() - Date.now();
    const safe = Math.max(0, total);
    return {
      d: Math.floor(safe / (1000 * 60 * 60 * 24)),
      h: Math.floor((safe / (1000 * 60 * 60)) % 24),
      m: Math.floor((safe / (1000 * 60)) % 60),
      s: Math.floor((safe / 1000) % 60),
      total: safe,
    };
  };
  const [t, setT] = useState(calc());
  useEffect(() => {
    const id = setInterval(() => setT(calc()), 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line
  }, [targetDate]);
  return t;
}

export const pad = (n) => String(n).padStart(2, "0");
