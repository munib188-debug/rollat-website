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
  const modeRef = useRef(null);
  const mountedRef = useRef(true);
  const timerRef = useRef(null);

  useEffect(() => {
    mountedRef.current = true;

    const cadenceMs = (phase, mode) => {
      // Single-mode spin animates over ~9s and we want the resolve to land
      // promptly, so poll at 1s.  Elimination rolls progress on a slower
      // server-side clock (eliminations are minutes/hours apart) and may
      // carry heavy custom-entry image payloads — poll at 3s to cut
      // bandwidth ~3× without making the UI feel stale.
      if (phase === "spinning") return mode === "elimination" ? 3000 : 1000;
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
        modeRef.current = data?.mode || null;
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
      }, cadenceMs(phaseRef.current, modeRef.current));
    };

    tick().then(loop);

    return () => {
      mountedRef.current = false;
      clearTimeout(timerRef.current);
    };
  }, []);

  return { roll, loading };
}
