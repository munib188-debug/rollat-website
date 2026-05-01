import { useEffect, useRef, useState } from "react";
import { api } from "./api";

/**
 * Polls /api/dev/roll/current and exposes the active dev roll (or null).
 *
 * Cadence mirrors useSpinState: idle/scheduled = 5s, spinning = 1s,
 * resolved = 2s (so the winner shows up promptly after the 9s spin
 * animation lands). When the public lifespan ends the backend returns
 * null and we settle back to the idle cadence.
 */
export function useDevRoll() {
  const [roll, setRoll] = useState(null);
  const [loading, setLoading] = useState(true);
  const phaseRef = useRef(null);
  const mountedRef = useRef(true);
  const timerRef = useRef(null);

  useEffect(() => {
    mountedRef.current = true;

    const cadenceMs = (phase) => {
      if (phase === "spinning") return 1000;
      if (phase === "resolved") return 2000;
      return 5000;
    };

    const tick = async () => {
      try {
        const r = await api.get("/dev/roll/current");
        if (!mountedRef.current) return;
        const data = r.data || null;
        setRoll(data);
        phaseRef.current = data?.phase || null;
      } catch (_) {
        // Network/cold-start errors are non-fatal; keep showing last good state.
      } finally {
        if (mountedRef.current) setLoading(false);
      }
    };

    const loop = () => {
      timerRef.current = setTimeout(async () => {
        await tick();
        if (mountedRef.current) loop();
      }, cadenceMs(phaseRef.current));
    };

    tick().then(loop);

    return () => {
      mountedRef.current = false;
      clearTimeout(timerRef.current);
    };
  }, []);

  return { roll, loading };
}
