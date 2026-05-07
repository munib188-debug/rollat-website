import { useEffect, useState, useRef } from "react";
import axios from "axios";
import { loadStoredAuth, clearAuth } from "./auth";

// Default to relative URLs (same-origin) so requests get proxied through
// Vercel's rewrites (see frontend/vercel.json). Locally, set
// REACT_APP_BACKEND_URL=http://localhost:8000 in .env.development.
const BACKEND = process.env.REACT_APP_BACKEND_URL || "";
const API = `${BACKEND}/api`;

// WebSocket can't be proxied through Vercel rewrites. We rely on /spin/state
// polling instead. Set REACT_APP_WS_URL explicitly if you want to point at a
// reachable WS endpoint (must be a full ws:// or wss:// URL).
const WS_URL = process.env.REACT_APP_WS_URL || null;

// 60s timeout — Render free tier cold-starts the dyno after ~15 min idle, and
// the first request can take 30–50s to wake it up.
export const api = axios.create({ baseURL: API, timeout: 60000 });

// Attach JWT (when present) to every request.
api.interceptors.request.use((config) => {
  const auth = loadStoredAuth();
  if (auth?.token) {
    config.headers = config.headers || {};
    config.headers.Authorization = `Bearer ${auth.token}`;
  }
  return config;
});

// On any 401 from a protected endpoint, drop the stored token so the UI re-prompts a sign-in.
api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err?.response?.status === 401) {
      clearAuth();
    }
    return Promise.reject(err);
  }
);

// Seconds-from-now to the next 12:00 UTC anchor (positive number, can be very large).
// Mirrors backend `_next_daily_spin`. Used to speed up polling near the daily spin moment.
function secondsToNextAnchor() {
  const now = new Date();
  const anchor = new Date(now);
  anchor.setUTCHours(12, 0, 0, 0);
  if (now >= anchor) anchor.setUTCDate(anchor.getUTCDate() + 1);
  return Math.max(0, (anchor.getTime() - now.getTime()) / 1000);
}

// True within ±60s of 12:00 UTC. During this window we tighten polling so the
// idle → spinning transition is observed within ~1s instead of up to 5–15s.
function isNearAnchor() {
  const s = secondsToNextAnchor();
  // s near 86340 means we just passed the anchor (within last 60s).
  return s <= 60 || s >= 86340;
}

export function useStats() {
  const [stats, setStats] = useState(null);
  useEffect(() => {
    let mounted = true;
    const fetchOnce = () => {
      api.get("/stats").then((r) => {
        if (mounted) setStats(r.data);
      }).catch(() => {});
    };
    fetchOnce();
    let timer;
    const schedule = () => {
      const interval = isNearAnchor() ? 3000 : 15000;
      timer = setTimeout(() => {
        fetchOnce();
        if (mounted) schedule();
      }, interval);
    };
    schedule();
    return () => { mounted = false; clearTimeout(timer); };
  }, []);
  return stats;
}

export function useWinners(limit = 12) {
  const [winners, setWinners] = useState([]);
  useEffect(() => {
    api.get(`/winners?limit=${limit}`).then((r) => setWinners(r.data)).catch(() => {});
  }, [limit]);
  return winners;
}

export function useSpinState() {
  const [spinState, setSpinState] = useState({ phase: "idle", winner: null, round_number: 0, participants: [], participants_count: 0 });
  const phaseRef = useRef("idle");
  const mountedRef = useRef(true);
  const pollRef = useRef(null);

  useEffect(() => {
    mountedRef.current = true;

    const idleInterval = () => (isNearAnchor() ? 1000 : 5000);
    const poll = (interval = idleInterval()) => {
      pollRef.current = setTimeout(async () => {
        try {
          const r = await api.get("/spin/state");
          if (mountedRef.current) {
            setSpinState(r.data);
            phaseRef.current = r.data.phase;
          }
        } catch (_) {}
        if (mountedRef.current) {
          poll(phaseRef.current === "spinning" ? 1000 : idleInterval());
        }
      }, interval);
    };

    // Initial fetch immediately
    api.get("/spin/state").then((r) => {
      if (mountedRef.current) {
        setSpinState(r.data);
        phaseRef.current = r.data.phase;
      }
    }).catch(() => {});

    poll();

    // Optional WebSocket for sub-second spin event push. Only attempted if
    // REACT_APP_WS_URL is explicitly set; otherwise the polling above is
    // sufficient and avoids leaking the backend hostname in the network tab.
    let ws = null;
    if (WS_URL) {
      try {
        ws = new WebSocket(WS_URL);
        ws.onmessage = (e) => {
          const event = JSON.parse(e.data);
          if (!mountedRef.current) return;
          if (event.event === "spin_started") {
            setSpinState((s) => ({ ...s, phase: "spinning" }));
            phaseRef.current = "spinning";
          } else if (event.event === "spin_resolved") {
            setSpinState((s) => ({ ...s, phase: "resolved", winner: event.winner }));
            phaseRef.current = "resolved";
          } else if (event.event === "spin_idle") {
            setSpinState((s) => ({ ...s, phase: "idle", winner: null }));
            phaseRef.current = "idle";
          }
        };
      } catch (_) {}
    }

    return () => {
      mountedRef.current = false;
      clearTimeout(pollRef.current);
      ws?.close();
    };
  }, []);

  return spinState;
}

export function useQualifiedWallets(page = 1, perPage = 50, search = "") {
  const [data, setData] = useState({
    wallets: [], total: 0, total_tickets: 0, page: 1, per_page: 50,
    qualification_active: true, snapshots_captured: 24,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.get(`/qualified-wallets?page=${page}&per_page=${perPage}&search=${encodeURIComponent(search)}`)
      .then((r) => { setData(r.data); setLoading(false); })
      .catch(() => setLoading(false));
  }, [page, perPage, search]);

  return { ...data, loading };
}
