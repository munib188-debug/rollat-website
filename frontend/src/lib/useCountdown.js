import { useState, useEffect, useRef } from "react";

const FIRING_WINDOW_MS = 120 * 1000;   // hold "firing" state for 2 min after the anchor passes
const ROLLOVER_JUMP_MS = 60 * 60 * 1000; // 1h+ jump = a new target, not a tick adjustment

export function useCountdown(targetDate) {
  // Anchor we set the moment we detect either (a) the target passing zero or (b) a forward
  // rollover happening near zero. While set, the consumer should render a "starting" state
  // instead of the new (next-day) countdown.
  const fireAnchorRef = useRef(null);
  const lastTargetRef = useRef(null);

  const calc = () => {
    if (!targetDate) return { d: 0, h: 0, m: 0, s: 0, total: 0, firing: false };
    const now = Date.now();
    const targetMs = new Date(targetDate).getTime();
    const prev = lastTargetRef.current;

    // Forward jump near zero = backend just rolled the next anchor to tomorrow.
    // Sticky-arm firing using the *previous* target so the window is anchored to T=0,
    // not to when the new target arrived.
    if (
      prev != null &&
      targetMs - prev > ROLLOVER_JUMP_MS &&
      now - prev < FIRING_WINDOW_MS &&
      fireAnchorRef.current == null
    ) {
      fireAnchorRef.current = prev;
    }
    lastTargetRef.current = targetMs;

    // Direct path: current target just passed zero.
    const total = targetMs - now;
    if (total <= 0 && fireAnchorRef.current == null) {
      fireAnchorRef.current = targetMs;
    }

    // Clear sticky once enough time has passed since the original anchor.
    if (fireAnchorRef.current != null && now - fireAnchorRef.current > FIRING_WINDOW_MS) {
      fireAnchorRef.current = null;
    }

    const safe = Math.max(0, total);
    return {
      d: Math.floor(safe / (1000 * 60 * 60 * 24)),
      h: Math.floor((safe / (1000 * 60 * 60)) % 24),
      m: Math.floor((safe / (1000 * 60)) % 60),
      s: Math.floor((safe / 1000) % 60),
      total: safe,
      firing: fireAnchorRef.current != null,
    };
  };

  const [t, setT] = useState(calc());
  useEffect(() => {
    setT(calc());
    const id = setInterval(() => setT(calc()), 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line
  }, [targetDate]);
  return t;
}

export const pad = (n) => String(n).padStart(2, "0");
