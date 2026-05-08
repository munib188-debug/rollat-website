import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowLeft, Calendar, Trash2, ShieldAlert, ShieldCheck, Plus, Trophy, Tag, Timer, X } from "lucide-react";
import { toast } from "sonner";
import { useWallet } from "@solana/wallet-adapter-react";
import { useAuth } from "@/lib/AuthContext";
import { api } from "@/lib/api";
import WalletPicker from "@/components/site/WalletPicker";
import LogoUpload from "@/components/site/LogoUpload";
import { safeHref, safeImgSrc } from "@/lib/utils";

const ACCENT = "#A855F7";

const EMPTY_ENTRY = () => ({ name: "", ticker: "", logo_url: "", link: "" });

function localUtcInputToIso(v) {
  if (!v) return null;
  const d = new Date(v + "Z");
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}

export default function GuestAdmin() {
  const { publicKey, disconnect } = useWallet();
  const connectedAddr = publicKey?.toBase58() || "";
  const { isAuthenticated, isAdmin, signIn, signingIn, signOut } = useAuth();
  const [pickerOpen, setPickerOpen] = useState(false);

  const [title, setTitle] = useState("");
  const [prizeLabel, setPrizeLabel] = useState("DexScreener Boost");
  const [entries, setEntries] = useState(() => Array.from({ length: 10 }, EMPTY_ENTRY));
  const [schedMode, setSchedMode] = useState("timer");
  const [timerHours, setTimerHours] = useState("1");
  const [timerMinutes, setTimerMinutes] = useState("0");
  const [scheduledAt, setScheduledAt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [current, setCurrent] = useState(null);
  const [history, setHistory] = useState([]);
  const [applications, setApplications] = useState([]);

  const refresh = async () => {
    const [cur, hist, apps] = await Promise.all([
      api.get("/guest/roll/current").then((r) => r.data).catch(() => null),
      isAdmin
        ? api.get("/guest/rolls").then((r) => r.data).catch(() => [])
        : Promise.resolve([]),
      isAdmin
        ? api.get("/guest/applications").then((r) => r.data).catch(() => [])
        : Promise.resolve([]),
    ]);
    setCurrent(cur);
    setHistory(Array.isArray(hist) ? hist : []);
    setApplications(Array.isArray(apps) ? apps : []);
  };

  const loadApplication = (app) => {
    // Push the application into the next empty entry slot.
    setEntries((prev) => {
      const idx = prev.findIndex((e) => !e.name && !e.ticker);
      if (idx === -1) {
        toast.error("All slots full — remove one first");
        return prev;
      }
      return prev.map((e, i) => i === idx ? {
        name: app.name || "",
        ticker: app.ticker || "",
        logo_url: app.logo_url || "",
        link: app.community_link || "",
      } : e);
    });
    toast.success(`Loaded $${app.ticker} into the form`);
  };

  const setApplicationStatus = async (appId, status) => {
    try {
      await api.patch(`/guest/applications/${appId}`, { status });
      await refresh();
    } catch (e) {
      toast.error("Failed", { description: e?.response?.data?.detail || e?.message });
    }
  };

  const deleteApplication = async (appId) => {
    try {
      await api.delete(`/guest/applications/${appId}`);
      await refresh();
    } catch (e) {
      toast.error("Failed", { description: e?.response?.data?.detail || e?.message });
    }
  };

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  const updateEntry = (i, key, value) => {
    setEntries((prev) => prev.map((e, j) => (j === i ? { ...e, [key]: value } : e)));
  };
  const addEntry = () => {
    if (entries.length >= 12) { toast.error("Max 12 entries"); return; }
    setEntries((prev) => [...prev, EMPTY_ENTRY()]);
  };
  const removeEntry = (i) => {
    if (entries.length <= 3) { toast.error("Min 3 entries"); return; }
    setEntries((prev) => prev.filter((_, j) => j !== i));
  };

  const handleSubmit = async () => {
    const cleaned = entries
      .map((e) => ({
        name: e.name.trim(),
        ticker: e.ticker.trim().replace(/^\$/, "").toUpperCase(),
        logo_url: e.logo_url.trim() || null,
        link: e.link.trim() || null,
      }))
      .filter((e) => e.name || e.ticker);

    if (cleaned.length < 3) { toast.error("Need at least 3 entries"); return; }
    const bad = cleaned.find((e) => !e.name || !e.ticker);
    if (bad) { toast.error("Each entry needs a name and ticker"); return; }
    const tickers = new Set();
    for (const e of cleaned) {
      if (tickers.has(e.ticker)) { toast.error(`Duplicate ticker: $${e.ticker}`); return; }
      tickers.add(e.ticker);
    }

    let iso;
    if (schedMode === "timer") {
      const h = Math.max(0, parseInt(timerHours) || 0);
      const m = Math.max(0, parseInt(timerMinutes) || 0);
      const total = h * 3600 + m * 60;
      if (total < 30) { toast.error("Timer must be at least 30 seconds"); return; }
      iso = new Date(Date.now() + total * 1000).toISOString();
    } else {
      iso = localUtcInputToIso(scheduledAt);
      if (!iso) { toast.error("Pick a UTC date & time"); return; }
    }

    setSubmitting(true);
    try {
      await api.post("/guest/roll", {
        title: title.trim() || undefined,
        prize_label: prizeLabel.trim() || "DexScreener Boost",
        entries: cleaned,
        scheduled_at: iso,
      });
      toast.success("Guest Roll scheduled");
      setTitle(""); setEntries(Array.from({ length: 10 }, EMPTY_ENTRY));
      await refresh();
    } catch (e) {
      toast.error("Failed", { description: e?.response?.data?.detail || e?.message });
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancel = async (id) => {
    try {
      await api.delete(`/guest/roll/${id}`);
      toast.success("Cancelled");
      await refresh();
    } catch (e) {
      toast.error("Failed to cancel", { description: e?.response?.data?.detail || e?.message });
    }
  };

  // ---------- Gates ----------
  if (!connectedAddr) {
    return (
      <Gate
        title="Connect to continue"
        description="Guest Roll admin requires a connected wallet."
        action={
          <>
            <Button onClick={() => setPickerOpen(true)} style={{ backgroundColor: ACCENT, color: "#fff" }}>
              Connect Wallet
            </Button>
            <WalletPicker open={pickerOpen} onClose={() => setPickerOpen(false)} />
          </>
        }
      />
    );
  }
  if (!isAuthenticated) {
    return (
      <Gate
        title="Sign in to continue"
        description="Verify wallet ownership to access admin actions."
        action={
          <Button onClick={signIn} disabled={signingIn} style={{ backgroundColor: ACCENT, color: "#fff" }}>
            {signingIn ? "Signing…" : "Sign-in with Solana"}
          </Button>
        }
      />
    );
  }
  if (!isAdmin) {
    return (
      <Gate
        title="Admin only"
        description="This wallet isn't on the admin allowlist."
        danger
        action={<Button variant="ghost" onClick={() => { signOut(); disconnect(); }}>Disconnect</Button>}
      />
    );
  }

  return (
    <div className="min-h-screen bg-obsidian-950 text-white px-6 py-12 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <Link to="/" className="inline-flex items-center gap-1.5 text-white/50 hover:text-white text-sm font-mono uppercase tracking-widest">
          <ArrowLeft className="w-4 h-4" /> Home
        </Link>
        <div className="flex items-center gap-3">
          <Link to="/admin/system" className="text-[10px] uppercase tracking-[0.25em] font-mono text-white/45 hover:text-white">
            System →
          </Link>
          <Link to="/dev" className="text-[10px] uppercase tracking-[0.25em] font-mono text-white/45 hover:text-white">
            Dev Roll →
          </Link>
          <Link to="/admin/payouts" className="text-[10px] uppercase tracking-[0.25em] font-mono text-white/45 hover:text-white">
            Payouts →
          </Link>
          <ShieldCheck className="w-4 h-4" style={{ color: ACCENT }} />
          <span className="font-mono text-xs" style={{ color: ACCENT }}>ADMIN</span>
        </div>
      </div>

      <h1 className="font-display font-black text-4xl md:text-5xl mb-2">
        Guest <span style={{ color: ACCENT }}>Roll.</span>
      </h1>
      <p className="text-white/55 mb-10 max-w-2xl">
        Schedule a 10-coin guest roll. One winning community gets the prize. Separate from
        the daily spin and dev rolls — never affects $ROLLAT stats.
      </p>

      {/* Current scheduled / spinning */}
      {current && (current.phase === "scheduled" || current.phase === "spinning") && (
        <div className="glass rounded-sm p-6 mb-8" style={{ borderColor: `${ACCENT}40` }}>
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-[10px] uppercase tracking-[0.3em] font-mono mb-1" style={{ color: ACCENT }}>
                {current.phase === "spinning" ? "Live · Spinning" : "Scheduled"}
              </div>
              <div className="font-display font-black text-2xl">{current.title || "Guest Roll"}</div>
              <div className="text-sm text-white/55 mt-1">
                Prize: <span className="text-white">{current.prize_label}</span> · {current.entries?.length || 0} entries
              </div>
              <div className="text-xs text-white/40 mt-2 font-mono">
                {new Date(current.scheduled_at).toUTCString()}
              </div>
            </div>
            {current.phase === "scheduled" && (
              <Button variant="ghost" onClick={() => handleCancel(current.id)} className="text-crimson hover:text-crimson">
                <Trash2 className="w-4 h-4 mr-1.5" /> Cancel
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Setup form */}
      <div className="glass rounded-sm p-6 md:p-8 mb-10">
        <div className="text-[10px] uppercase tracking-[0.3em] font-mono mb-4" style={{ color: ACCENT }}>
          New Guest Roll
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          <div>
            <Label icon={<Tag className="w-3 h-3" />} text="Title (optional)" />
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Cycle #1"
              maxLength={60}
            />
          </div>
          <div>
            <Label icon={<Trophy className="w-3 h-3" />} text="Prize" />
            <Input
              value={prizeLabel}
              onChange={(e) => setPrizeLabel(e.target.value)}
              placeholder="DexScreener Boost"
              maxLength={60}
            />
          </div>
        </div>

        {/* Schedule mode */}
        <div className="mb-6">
          <Label icon={<Calendar className="w-3 h-3" />} text="Schedule" />
          <div className="flex gap-2 mb-3">
            <button
              onClick={() => setSchedMode("timer")}
              className={`px-3 py-1.5 rounded-sm border text-xs uppercase tracking-widest font-mono ${schedMode === "timer" ? "bg-white/10 border-white/30 text-white" : "border-white/10 text-white/45"}`}
            >
              <Timer className="w-3 h-3 inline mr-1" /> Timer
            </button>
            <button
              onClick={() => setSchedMode("datetime")}
              className={`px-3 py-1.5 rounded-sm border text-xs uppercase tracking-widest font-mono ${schedMode === "datetime" ? "bg-white/10 border-white/30 text-white" : "border-white/10 text-white/45"}`}
            >
              <Calendar className="w-3 h-3 inline mr-1" /> Date & Time
            </button>
          </div>
          {schedMode === "timer" ? (
            <div className="flex items-center gap-2">
              <Input type="number" min="0" value={timerHours} onChange={(e) => setTimerHours(e.target.value)} className="max-w-[100px]" />
              <span className="text-white/40 text-xs">hrs</span>
              <Input type="number" min="0" max="59" value={timerMinutes} onChange={(e) => setTimerMinutes(e.target.value)} className="max-w-[100px]" />
              <span className="text-white/40 text-xs">min</span>
            </div>
          ) : (
            <Input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />
          )}
        </div>

        {/* Entries */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <Label icon={<Trophy className="w-3 h-3" />} text={`Entries · ${entries.length}`} />
            <Button size="sm" variant="ghost" onClick={addEntry} disabled={entries.length >= 12}>
              <Plus className="w-3 h-3 mr-1" /> Add
            </Button>
          </div>
          <div className="space-y-2">
            {entries.map((e, i) => (
              <div key={i} className="grid grid-cols-12 gap-2 items-center p-2 rounded-sm border border-white/5 bg-obsidian-900/40">
                <div className="col-span-1 text-center font-mono text-xs text-white/30">#{i + 1}</div>
                <Input
                  className="col-span-3"
                  placeholder="Name (e.g. Bonk)"
                  value={e.name}
                  onChange={(ev) => updateEntry(i, "name", ev.target.value)}
                  maxLength={40}
                />
                <Input
                  className="col-span-2"
                  placeholder="$TICKER"
                  value={e.ticker}
                  onChange={(ev) => updateEntry(i, "ticker", ev.target.value)}
                  maxLength={16}
                />
                <div className="col-span-3">
                  <LogoUpload
                    value={e.logo_url || null}
                    onChange={(v) => updateEntry(i, "logo_url", v || "")}
                    compact
                  />
                </div>
                <Input
                  className="col-span-2"
                  placeholder="Community link"
                  value={e.link}
                  onChange={(ev) => updateEntry(i, "link", ev.target.value)}
                />
                <button
                  onClick={() => removeEntry(i)}
                  className="col-span-1 text-white/30 hover:text-crimson"
                  disabled={entries.length <= 3}
                >
                  <X className="w-4 h-4 mx-auto" />
                </button>
              </div>
            ))}
          </div>
        </div>

        <Button
          onClick={handleSubmit}
          disabled={submitting}
          style={{ backgroundColor: ACCENT, color: "#fff" }}
          className="w-full"
        >
          {submitting ? "Scheduling…" : "Schedule Guest Roll"}
        </Button>
      </div>

      {/* Applications inbox — public submissions from /guest-invite */}
      <div className="mb-10">
        <div className="flex items-center justify-between mb-3">
          <div className="text-[10px] uppercase tracking-[0.3em] font-mono text-white/40">
            Applications · {applications.length}
          </div>
          <a
            href="/guest-invite"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10px] uppercase tracking-[0.25em] font-mono text-white/45 hover:text-white"
          >
            View public page →
          </a>
        </div>
        <div className="space-y-2">
          {applications.length === 0 && (
            <div className="text-sm text-white/40 font-mono">No applications yet — share rollat.vercel.app/guest-invite to start collecting submissions.</div>
          )}
          {applications.map((app) => {
            const statusColor = app.status === "approved" ? "#10B981" : app.status === "rejected" ? "#FF3366" : ACCENT;
            return (
              <div key={app.id} className="glass rounded-sm p-4 flex items-start gap-4">
                {safeImgSrc(app.logo_url) ? (
                  <img src={safeImgSrc(app.logo_url)} alt="" className="w-10 h-10 rounded-sm object-cover shrink-0 border border-white/10" />
                ) : app.logo_inline ? (
                  <div className="w-10 h-10 rounded-sm bg-white/5 shrink-0 flex items-center justify-center text-[8px] font-mono text-white/40 uppercase tracking-widest">img</div>
                ) : (
                  <div className="w-10 h-10 rounded-sm bg-white/5 shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold">${app.ticker}</span>
                    <span className="text-white/55 truncate">{app.name}</span>
                    <span
                      className="px-1.5 py-0.5 rounded-sm text-[9px] font-mono uppercase tracking-widest"
                      style={{ backgroundColor: `${statusColor}20`, color: statusColor }}
                    >
                      {app.status}
                    </span>
                  </div>
                  <div className="text-xs text-white/45 font-mono mt-1 truncate">
                    {app.contact} · {new Date(app.created_at).toUTCString().slice(5, 16)}
                  </div>
                  <div className="text-xs text-white/40 mt-1 flex items-center gap-3 flex-wrap">
                    <a href={safeHref(app.community_link)} target="_blank" rel="noopener noreferrer" className="hover:text-white underline truncate max-w-[300px]">
                      {app.community_link}
                    </a>
                    {app.contract_address && (
                      <span className="font-mono text-[10px] text-white/35 truncate">
                        CA: {app.contract_address.slice(0, 8)}…
                      </span>
                    )}
                  </div>
                  {app.notes && (
                    <div className="text-xs text-white/55 mt-2 italic">"{app.notes}"</div>
                  )}
                </div>
                <div className="flex flex-col gap-1.5 shrink-0">
                  <Button size="sm" onClick={() => loadApplication(app)} style={{ backgroundColor: ACCENT, color: "#fff" }} className="h-7 px-2 text-[10px]">
                    Use
                  </Button>
                  {app.status !== "approved" && (
                    <Button size="sm" variant="ghost" onClick={() => setApplicationStatus(app.id, "approved")} className="h-7 px-2 text-[10px] text-emerald-400 hover:text-emerald-300">
                      ✓ Approve
                    </Button>
                  )}
                  {app.status !== "rejected" && (
                    <Button size="sm" variant="ghost" onClick={() => setApplicationStatus(app.id, "rejected")} className="h-7 px-2 text-[10px] text-white/40 hover:text-crimson">
                      ✗ Reject
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => deleteApplication(app.id)} className="h-7 px-2 text-[10px] text-white/30 hover:text-crimson">
                    Delete
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* History */}
      <div>
        <div className="text-[10px] uppercase tracking-[0.3em] font-mono mb-3 text-white/40">
          History · {history.length}
        </div>
        <div className="space-y-2">
          {history.length === 0 && (
            <div className="text-sm text-white/40 font-mono">No guest rolls yet.</div>
          )}
          {history.map((r) => (
            <div key={r.id} className="glass rounded-sm p-4 flex items-center justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="font-bold truncate">{r.title || "Guest Roll"}</div>
                <div className="text-xs text-white/45 font-mono mt-1">
                  {r.phase} · {r.prize_label} · {r.entries?.length || 0} entries
                  {r.winner && <> · 🏆 ${r.winner.ticker}</>}
                </div>
              </div>
              <div className="text-[10px] text-white/30 font-mono uppercase tracking-widest shrink-0">
                {new Date(r.scheduled_at).toUTCString().slice(5, 22)}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Gate({ title, description, action, danger }) {
  return (
    <div className="min-h-screen bg-obsidian-950 text-white flex items-center justify-center p-6">
      <div className="max-w-md text-center">
        {danger ? (
          <ShieldAlert className="w-12 h-12 mx-auto mb-4 text-crimson" />
        ) : (
          <ShieldCheck className="w-12 h-12 mx-auto mb-4" style={{ color: ACCENT }} />
        )}
        <h1 className="font-display font-black text-3xl mb-2">{title}</h1>
        <p className="text-white/55 mb-6">{description}</p>
        {action}
      </div>
    </div>
  );
}

function Label({ icon, text }) {
  return (
    <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.25em] font-mono text-white/45 mb-2">
      {icon}
      {text}
    </div>
  );
}
