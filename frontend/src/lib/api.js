import { useEffect, useState, useRef } from "react";
import axios from "axios";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const WS_URL = (process.env.REACT_APP_BACKEND_URL || "").replace(/^http/, "ws") + "/ws/spin";

export const api = axios.create({ baseURL: API });

export function useStats() {
  const [stats, setStats] = useState(null);
  useEffect(() => {
    let mounted = true;
    api.get("/stats").then((r) => {
      if (mounted) setStats(r.data);
    }).catch(() => {});
    const id = setInterval(() => {
      api.get("/stats").then((r) => {
        if (mounted) setStats(r.data);
      }).catch(() => {});
    }, 15000);
    return () => { mounted = false; clearInterval(id); };
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

    const poll = (interval = 5000) => {
      pollRef.current = setTimeout(async () => {
        try {
          const r = await api.get("/spin/state");
          if (mountedRef.current) {
            setSpinState(r.data);
            phaseRef.current = r.data.phase;
          }
        } catch (_) {}
        if (mountedRef.current) {
          poll(phaseRef.current === "spinning" ? 1000 : 5000);
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

    // WebSocket for real-time events
    let ws = null;
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

    return () => {
      mountedRef.current = false;
      clearTimeout(pollRef.current);
      ws?.close();
    };
  }, []);

  return spinState;
}

export function useQualifiedWallets(page = 1, perPage = 50, search = "") {
  const [data, setData] = useState({ wallets: [], total: 0, total_tickets: 0, page: 1, per_page: 50 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.get(`/qualified-wallets?page=${page}&per_page=${perPage}&search=${encodeURIComponent(search)}`)
      .then((r) => { setData(r.data); setLoading(false); })
      .catch(() => setLoading(false));
  }, [page, perPage, search]);

  return { ...data, loading };
}
