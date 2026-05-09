import { useEffect, useRef, useState } from "react";
import { api } from "./api";

/**
 * Polls /api/dev/roll/{rollId}/supporters and exposes:
 *   - teams: [{ team_entry_id, supporter_count }, ...]
 *   - total: total supporters across all teams
 *   - my:   the caller's sign-up record for this roll, or null
 *   - reload: imperative refresher (call after a successful sign-up)
 *
 * Cadence is gentle since supporter counts only change when a user signs up
 * (during scheduled phase) or a team is eliminated (one tick per interval).
 *   scheduled phase  → 4s
 *   spinning phase   → 8s
 *   resolved phase   → 30s (just one final read; data is frozen)
 *   anything else    → off
 */
export function useTournamentSupporters({ rollId, phase, wallet }) {
  const [data, setData] = useState({ teams: [], total: 0, my: null });
  const mountedRef = useRef(true);
  const timerRef = useRef(null);
  const phaseRef = useRef(phase);

  const tick = async () => {
    if (!rollId) return;
    try {
      const url = wallet
        ? `/dev/roll/${rollId}/supporters?wallet=${encodeURIComponent(wallet)}`
        : `/dev/roll/${rollId}/supporters`;
      const r = await api.get(url);
      if (!mountedRef.current) return;
      setData({
        teams: r.data?.teams || [],
        total: r.data?.total ?? 0,
        my: r.data?.my ?? null,
      });
    } catch (_) {
      // Soft-fail. Counts will refresh on the next tick.
    }
  };

  useEffect(() => {
    mountedRef.current = true;
    phaseRef.current = phase;

    const cadenceMs = (p) => {
      if (p === "scheduled") return 4000;
      if (p === "spinning") return 8000;
      if (p === "resolved") return 30000;
      return null; // no polling for cancelled / unknown
    };

    const loop = () => {
      const ms = cadenceMs(phaseRef.current);
      if (ms == null) return;
      timerRef.current = setTimeout(async () => {
        await tick();
        if (mountedRef.current) loop();
      }, ms);
    };

    tick().then(loop);

    return () => {
      mountedRef.current = false;
      clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rollId, phase, wallet]);

  // Imperative refresher used right after a sign-up POST so the team grid
  // doesn't have to wait a full poll tick to show the bumped count.
  const reload = () => tick();

  return { ...data, reload };
}
