import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ArrowLeft, Wallet, Pen, ShieldAlert, ShieldCheck, Save,
  Settings, UserX, Camera, Trash2, Plus, RefreshCw, Flame,
  MessageSquare, Send, Power, RotateCcw,
} from "lucide-react";
import { toast } from "sonner";
import { useWallet } from "@solana/wallet-adapter-react";
import { useAuth } from "@/lib/AuthContext";
import { api } from "@/lib/api";
import { truncWallet } from "@/lib/walletUtils";
import WalletPicker from "@/components/site/WalletPicker";

const ACCENT = "#FFD700";

const fmtDate = (d) => {
  if (!d) return "—";
  const dt = new Date(d);
  return dt.toLocaleString("en-US", {
    month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit", timeZone: "UTC",
  }) + " UTC";
};

export default function SystemAdmin() {
  const { publicKey, disconnect } = useWallet();
  const connectedAddr = publicKey?.toBase58() || "";
  const { isAuthenticated, isAdmin, signIn, signingIn, signOut } = useAuth();
  const [pickerOpen, setPickerOpen] = useState(false);

  if (!connectedAddr || !isAuthenticated || !isAdmin) {
    return (
      <Shell
        connectedAddr={connectedAddr}
        disconnect={disconnect}
        signOut={signOut}
        isAdmin={isAdmin}
        onConnect={() => setPickerOpen(true)}
        pickerOpen={pickerOpen}
        setPickerOpen={setPickerOpen}
      >
        {!connectedAddr && (
          <Gate
            title="Connect a wallet to continue"
            description="System admin is gated by the on-chain admin allowlist."
            action={
              <Button
                onClick={() => setPickerOpen(true)}
                className="bg-white text-obsidian-950 font-bold uppercase tracking-widest text-xs rounded-sm h-12 px-6"
              >
                <Wallet className="w-4 h-4 mr-2" /> Connect Wallet
              </Button>
            }
          />
        )}
        {connectedAddr && !isAuthenticated && (
          <Gate
            title="Sign a message to verify ownership"
            description="Sign-in proves you control this wallet. No transaction is broadcast."
            action={
              <Button
                onClick={async () => {
                  try { await signIn(); }
                  catch (err) { toast.error("Sign-in failed", { description: err?.message }); }
                }}
                disabled={signingIn}
                className="bg-white text-obsidian-950 font-bold uppercase tracking-widest text-xs rounded-sm h-12 px-6"
              >
                <Pen className="w-4 h-4 mr-2" /> {signingIn ? "Signing…" : "Sign In"}
              </Button>
            }
          />
        )}
        {connectedAddr && isAuthenticated && !isAdmin && (
          <Gate
            danger
            title="Admin only"
            description={`This wallet (${truncWallet(connectedAddr)}) is not on the admin allowlist.`}
          />
        )}
      </Shell>
    );
  }

  return (
    <Shell
      connectedAddr={connectedAddr}
      disconnect={disconnect}
      signOut={signOut}
      isAdmin={isAdmin}
      onConnect={() => setPickerOpen(true)}
      pickerOpen={pickerOpen}
      setPickerOpen={setPickerOpen}
    >
      <div className="mb-8">
        <div className="text-[10px] uppercase tracking-[0.3em] font-mono mb-2" style={{ color: ACCENT }}>
          System Control
        </div>
        <h1 className="font-display font-black text-3xl md:text-4xl tracking-tighter mb-2">
          Live config, exclusions, snapshots.
        </h1>
        <p className="text-white/55 max-w-2xl">
          Tweak prize amounts, qualification thresholds, and the wallet exclusion list at runtime.
          All changes apply within ~30 seconds — no redeploy.
        </p>
      </div>

      <ConfigSection />
      <ExclusionsSection />
      <SnapshotsSection />
      <TelegramBotSection />
    </Shell>
  );
}

function Shell({ connectedAddr, disconnect, signOut, isAdmin, onConnect, pickerOpen, setPickerOpen, children }) {
  return (
    <div className="min-h-screen bg-obsidian-950 grain felt-bg" data-testid="system-admin-page">
      <header className="sticky top-0 z-40 glass border-b border-white/5">
        <div className="max-w-[1400px] mx-auto px-6 md:px-12 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2.5 group">
            <ArrowLeft className="w-4 h-4 text-white/50 group-hover:text-gold" />
            <div className="w-8 h-8 rounded-full roulette-wheel" />
            <span className="font-display font-black text-xl tracking-tight">$ROLLAT</span>
            <span
              className="hidden md:inline text-[10px] uppercase tracking-[0.25em] font-mono border px-2 py-1 rounded-sm ml-2"
              style={{ color: ACCENT, borderColor: `${ACCENT}55` }}
            >
              SYSTEM · ADMIN
            </span>
          </Link>
          <div className="hidden md:flex items-center gap-1 mr-2">
            <AdminNavLink to="/admin/system" current>System</AdminNavLink>
            <AdminNavLink to="/admin/payouts">Payouts</AdminNavLink>
            <AdminNavLink to="/dev">Dev</AdminNavLink>
            <AdminNavLink to="/guest">Guest</AdminNavLink>
          </div>
          <div className="flex items-center gap-2">
            {connectedAddr && (
              <span className="hidden md:inline-flex items-center gap-2 px-3 h-9 border border-white/10 text-white/70 rounded-sm font-mono text-[11px] uppercase tracking-widest">
                {truncWallet(connectedAddr)}
                {isAdmin && <ShieldCheck className="w-3.5 h-3.5" style={{ color: ACCENT }} />}
              </span>
            )}
            {connectedAddr ? (
              <Button
                onClick={() => { disconnect(); signOut(); }}
                variant="outline"
                className="border-white/15 bg-transparent text-white hover:bg-white/5 h-9 px-4 font-mono text-[11px] uppercase tracking-widest rounded-sm"
              >
                Disconnect
              </Button>
            ) : (
              <Button
                onClick={onConnect}
                className="bg-white text-obsidian-950 hover:bg-white/90 h-9 px-4 font-mono text-[11px] uppercase tracking-widest rounded-sm font-bold"
              >
                <Wallet className="w-3.5 h-3.5 mr-2" /> Connect
              </Button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-[1100px] mx-auto px-6 md:px-12 py-10 md:py-14">
        {children}
      </main>

      <WalletPicker open={pickerOpen} onClose={() => setPickerOpen(false)} />
    </div>
  );
}

function AdminNavLink({ to, children, current }) {
  return (
    <Link
      to={to}
      className={`px-3 h-9 inline-flex items-center font-mono text-[11px] uppercase tracking-widest rounded-sm transition-colors ${
        current ? "text-gold border border-gold/40" : "text-white/50 hover:text-white border border-transparent hover:border-white/10"
      }`}
    >
      {children}
    </Link>
  );
}

function Gate({ title, description, action, danger }) {
  return (
    <div className="glass rounded-sm p-10 md:p-14 text-center" data-testid="system-admin-gate">
      <div
        className="mx-auto w-12 h-12 rounded-sm flex items-center justify-center mb-5"
        style={{ backgroundColor: danger ? "#FF336622" : "#ffffff10" }}
      >
        {danger
          ? <ShieldAlert className="w-6 h-6" style={{ color: "#FF3366" }} />
          : <ShieldCheck className="w-6 h-6 text-white/70" />}
      </div>
      <h2 className="font-display font-black text-2xl md:text-3xl tracking-tighter mb-3">{title}</h2>
      <p className="text-white/55 max-w-xl mx-auto mb-6">{description}</p>
      {action && <div className="flex justify-center">{action}</div>}
    </div>
  );
}

function SectionHeader({ icon: Icon, title, description }) {
  return (
    <div className="flex items-start gap-3 mb-5">
      <div className="w-9 h-9 rounded-sm bg-white/5 flex items-center justify-center flex-shrink-0">
        <Icon className="w-4 h-4" style={{ color: ACCENT }} />
      </div>
      <div>
        <h2 className="font-display font-bold text-xl tracking-tight">{title}</h2>
        <p className="text-white/50 text-sm mt-0.5">{description}</p>
      </div>
    </div>
  );
}

function ConfigSection() {
  const [cfg, setCfg] = useState(null);
  const [defaults, setDefaults] = useState(null);
  const [draft, setDraft] = useState({});
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.get("/admin/config");
      setCfg(r.data.current);
      setDefaults(r.data.defaults);
      setDraft({
        fixed_daily_prize_sol: r.data.current.fixed_daily_prize_sol ?? "",
        pot_threshold_sol: r.data.current.pot_threshold_sol ?? "",
        min_qualifying_tokens: r.data.current.min_qualifying_tokens ?? "",
        streak_bonus_enabled: r.data.current.streak_bonus_enabled ?? true,
        streak_week_threshold: r.data.current.streak_week_threshold ?? 7,
        streak_month_threshold: r.data.current.streak_month_threshold ?? 30,
        streak_grace_days: r.data.current.streak_grace_days ?? 1,
        max_bonus_tickets: r.data.current.max_bonus_tickets ?? 10,
      });
    } catch (err) {
      toast.error("Could not load config", { description: err?.response?.data?.detail || err?.message });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const save = async () => {
    setSaving(true);
    try {
      const payload = {};
      const fp = draft.fixed_daily_prize_sol;
      if (fp === "" || fp === null) {
        payload.fixed_daily_prize_sol = null;
      } else {
        payload.fixed_daily_prize_sol = Number(fp);
      }
      payload.pot_threshold_sol = Number(draft.pot_threshold_sol);
      payload.min_qualifying_tokens = Number(draft.min_qualifying_tokens);
      payload.streak_bonus_enabled = !!draft.streak_bonus_enabled;
      payload.streak_week_threshold = Number(draft.streak_week_threshold);
      payload.streak_month_threshold = Number(draft.streak_month_threshold);
      payload.streak_grace_days = Number(draft.streak_grace_days);
      payload.max_bonus_tickets = Number(draft.max_bonus_tickets);

      const r = await api.patch("/admin/config", payload);
      setCfg(r.data.current);
      toast.success("Config saved");
    } catch (err) {
      toast.error("Save failed", { description: err?.response?.data?.detail || err?.message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="border border-white/5 rounded-sm bg-obsidian-900/40 p-5 md:p-7 mb-6" data-testid="system-config-section">
      <SectionHeader
        icon={Settings}
        title="Runtime Config"
        description="Prize amount, pot threshold, and qualifying balance — applied within ~30s."
      />
      {loading ? (
        <div className="text-white/40 font-mono text-sm py-6">Loading…</div>
      ) : (
        <div className="space-y-4">
          <ConfigField
            label="Fixed Daily Prize (SOL)"
            hint="When set, every spin pays this fixed amount regardless of pot. Leave blank for whole-pot mode."
            value={draft.fixed_daily_prize_sol}
            onChange={(v) => setDraft((d) => ({ ...d, fixed_daily_prize_sol: v }))}
            placeholder="e.g. 0.1 (or empty for pot-mode)"
            currentLabel={cfg?.fixed_daily_prize_sol == null ? "(disabled — pot-mode)" : `${cfg.fixed_daily_prize_sol} SOL`}
            defaultLabel={defaults?.fixed_daily_prize_sol == null ? "(disabled)" : `${defaults.fixed_daily_prize_sol} SOL`}
          />
          <ConfigField
            label="Pot Threshold (SOL)"
            hint="Minimum pot required to spin in pot-mode. Ignored when a fixed prize is set."
            value={draft.pot_threshold_sol}
            onChange={(v) => setDraft((d) => ({ ...d, pot_threshold_sol: v }))}
            placeholder="e.g. 1.0"
            currentLabel={`${cfg?.pot_threshold_sol} SOL`}
            defaultLabel={`${defaults?.pot_threshold_sol} SOL`}
          />
          <ConfigField
            label="Min Qualifying Tokens"
            hint="Wallets must hold at least this many $ROLLAT in every snapshot of the 24h window."
            value={draft.min_qualifying_tokens}
            onChange={(v) => setDraft((d) => ({ ...d, min_qualifying_tokens: v }))}
            placeholder="e.g. 1000000"
            currentLabel={Number(cfg?.min_qualifying_tokens || 0).toLocaleString()}
            defaultLabel={Number(defaults?.min_qualifying_tokens || 0).toLocaleString()}
          />

          <div className="border-t border-white/5 pt-5 mt-2">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Flame className="w-4 h-4 text-gold" />
                <h3 className="font-display font-bold text-base tracking-tight">Long-term Holder Bonus</h3>
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={!!draft.streak_bonus_enabled}
                  onChange={(e) => setDraft((d) => ({ ...d, streak_bonus_enabled: e.target.checked }))}
                  className="accent-gold"
                />
                <span className="font-mono text-[11px] uppercase tracking-widest text-white/70">
                  {draft.streak_bonus_enabled ? "Enabled" : "Disabled"}
                </span>
              </label>
            </div>
            <p className="text-[11px] text-white/40 mb-4 leading-relaxed">
              Streak counts consecutive rounds (days) a wallet stays qualified. +1 ticket once the streak hits the
              week threshold, then +1 every additional month. Capped at the bonus cap below.
            </p>
            <div className="space-y-4">
              <ConfigField
                label="Week Threshold (days)"
                hint="Days of consecutive qualification before the first +1 bonus kicks in."
                value={draft.streak_week_threshold}
                onChange={(v) => setDraft((d) => ({ ...d, streak_week_threshold: v }))}
                placeholder="7"
                currentLabel={`${cfg?.streak_week_threshold ?? "?"} days`}
                defaultLabel={`${defaults?.streak_week_threshold ?? "?"} days`}
              />
              <ConfigField
                label="Month Threshold (days)"
                hint="Days per additional +1 bonus after the week threshold (defaults to a calendar month)."
                value={draft.streak_month_threshold}
                onChange={(v) => setDraft((d) => ({ ...d, streak_month_threshold: v }))}
                placeholder="30"
                currentLabel={`${cfg?.streak_month_threshold ?? "?"} days`}
                defaultLabel={`${defaults?.streak_month_threshold ?? "?"} days`}
              />
              <ConfigField
                label="Grace Days (0 or 1)"
                hint="Forgive a single missed round per streak. Set 0 for strict streaks."
                value={draft.streak_grace_days}
                onChange={(v) => setDraft((d) => ({ ...d, streak_grace_days: v }))}
                placeholder="1"
                currentLabel={`${cfg?.streak_grace_days ?? "?"}`}
                defaultLabel={`${defaults?.streak_grace_days ?? "?"}`}
              />
              <ConfigField
                label="Max Bonus Tickets"
                hint="Hard cap on bonus tickets — stops a multi-year holder from dominating."
                value={draft.max_bonus_tickets}
                onChange={(v) => setDraft((d) => ({ ...d, max_bonus_tickets: v }))}
                placeholder="10"
                currentLabel={`+${cfg?.max_bonus_tickets ?? "?"}`}
                defaultLabel={`+${defaults?.max_bonus_tickets ?? "?"}`}
              />
            </div>
          </div>

          <div className="flex items-center justify-between pt-2">
            <div className="text-[10px] font-mono text-white/35 uppercase tracking-widest">
              {cfg?.updated_at && <>Last edit: {fmtDate(cfg.updated_at)} · {truncWallet(cfg.updated_by || "")}</>}
            </div>
            <div className="flex gap-2">
              <Button
                onClick={load}
                variant="outline"
                className="border-white/15 bg-transparent text-white/70 hover:text-white hover:bg-white/5 h-10 px-3 font-mono text-[11px] uppercase tracking-widest rounded-sm"
              >
                <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Reload
              </Button>
              <Button
                onClick={save}
                disabled={saving}
                className="bg-gold text-obsidian-950 hover:bg-gold/90 disabled:opacity-40 h-10 px-4 font-mono text-[11px] uppercase tracking-widest rounded-sm font-bold"
              >
                <Save className="w-3.5 h-3.5 mr-1.5" /> {saving ? "Saving…" : "Save Config"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function ConfigField({ label, hint, value, onChange, placeholder, currentLabel, defaultLabel }) {
  return (
    <div className="grid md:grid-cols-12 gap-3 items-start">
      <div className="md:col-span-5">
        <div className="font-mono text-[11px] uppercase tracking-widest text-white/70">{label}</div>
        <div className="text-[11px] text-white/35 mt-1">{hint}</div>
      </div>
      <div className="md:col-span-4">
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="bg-obsidian-950/60 border-white/10 font-mono text-xs"
        />
      </div>
      <div className="md:col-span-3 text-[10px] font-mono text-white/45 leading-relaxed">
        <div>now: <span className="text-white/75">{currentLabel}</span></div>
        <div>default: <span className="text-white/55">{defaultLabel}</span></div>
      </div>
    </div>
  );
}

function ExclusionsSection() {
  const [list, setList] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.get("/admin/config");
      setList(r.data.current.excluded_wallets || []);
    } catch (err) {
      toast.error("Could not load exclusions", { description: err?.response?.data?.detail || err?.message });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const persist = async (next) => {
    setSaving(true);
    try {
      const r = await api.patch("/admin/config", { excluded_wallets: next });
      setList(r.data.current.excluded_wallets || []);
      toast.success("Exclusion list updated");
    } catch (err) {
      toast.error("Update failed", { description: err?.response?.data?.detail || err?.message });
      load();
    } finally {
      setSaving(false);
    }
  };

  const add = async () => {
    const w = input.trim();
    if (!w) return;
    if (list.includes(w)) {
      toast.error("Already excluded");
      return;
    }
    const next = [...list, w];
    setInput("");
    await persist(next);
  };

  const remove = async (w) => {
    if (!window.confirm(`Remove ${truncWallet(w)} from exclusion list?`)) return;
    const next = list.filter((x) => x !== w);
    await persist(next);
  };

  return (
    <section className="border border-white/5 rounded-sm bg-obsidian-900/40 p-5 md:p-7 mb-6" data-testid="system-exclusions-section">
      <SectionHeader
        icon={UserX}
        title="Excluded Wallets"
        description="Wallets here are stripped from the spin pool and qualification queries."
      />
      {loading ? (
        <div className="text-white/40 font-mono text-sm py-6">Loading…</div>
      ) : (
        <>
          <div className="flex flex-col md:flex-row gap-2 mb-5">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") add(); }}
              placeholder="Solana wallet address (base58)"
              className="bg-obsidian-950/60 border-white/10 font-mono text-xs"
            />
            <Button
              onClick={add}
              disabled={saving || !input.trim()}
              className="bg-gold text-obsidian-950 hover:bg-gold/90 disabled:opacity-40 h-10 px-4 font-mono text-[11px] uppercase tracking-widest rounded-sm font-bold"
            >
              <Plus className="w-3.5 h-3.5 mr-1.5" /> Add
            </Button>
          </div>

          {list.length === 0 ? (
            <div className="text-white/35 font-mono text-xs py-3">No excluded wallets.</div>
          ) : (
            <div className="space-y-1.5">
              {list.map((w) => (
                <div
                  key={w}
                  className="flex items-center justify-between border border-white/5 hover:border-white/10 rounded-sm px-3 py-2 bg-obsidian-950/40"
                >
                  <span className="font-mono text-xs text-white/75 break-all">{w}</span>
                  <Button
                    onClick={() => remove(w)}
                    disabled={saving}
                    variant="outline"
                    className="border-white/10 bg-transparent text-white/50 hover:text-crimson hover:border-crimson/40 h-8 px-2 font-mono text-[10px] uppercase tracking-widest rounded-sm flex-shrink-0 ml-3"
                  >
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}

function SnapshotsSection() {
  const [snaps, setSnaps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [capturing, setCapturing] = useState(false);
  const [deleting, setDeleting] = useState({});

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.get("/admin/snapshots", { params: { limit: 48 } });
      setSnaps(Array.isArray(r.data) ? r.data : []);
    } catch (err) {
      toast.error("Could not load snapshots", { description: err?.response?.data?.detail || err?.message });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const captureNow = async () => {
    setCapturing(true);
    try {
      const r = await api.post("/admin/snapshots/capture");
      toast.success(`Captured ${r.data.total_holders} holders`);
      await load();
    } catch (err) {
      toast.error("Capture failed", { description: err?.response?.data?.detail || err?.message });
    } finally {
      setCapturing(false);
    }
  };

  const remove = async (id) => {
    if (!window.confirm("Delete this snapshot? Qualification needs 24 consecutive snapshots — deleting recent ones will pause qualification until the window refills.")) return;
    setDeleting((d) => ({ ...d, [id]: true }));
    try {
      await api.delete(`/admin/snapshots/${id}`);
      setSnaps((s) => s.filter((x) => x.id !== id));
      toast.success("Snapshot deleted");
    } catch (err) {
      toast.error("Delete failed", { description: err?.response?.data?.detail || err?.message });
    } finally {
      setDeleting((d) => ({ ...d, [id]: false }));
    }
  };

  return (
    <section className="border border-white/5 rounded-sm bg-obsidian-900/40 p-5 md:p-7" data-testid="system-snapshots-section">
      <div className="flex items-start justify-between mb-5 gap-3">
        <SectionHeader
          icon={Camera}
          title="Snapshots"
          description="Hourly holder snapshots — qualification needs 24 consecutive ones."
        />
        <div className="flex gap-2 flex-shrink-0">
          <Button
            onClick={load}
            variant="outline"
            className="border-white/15 bg-transparent text-white/70 hover:text-white hover:bg-white/5 h-10 px-3 font-mono text-[11px] uppercase tracking-widest rounded-sm"
          >
            <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Reload
          </Button>
          <Button
            onClick={captureNow}
            disabled={capturing}
            className="bg-gold text-obsidian-950 hover:bg-gold/90 disabled:opacity-40 h-10 px-4 font-mono text-[11px] uppercase tracking-widest rounded-sm font-bold"
          >
            <Camera className="w-3.5 h-3.5 mr-1.5" /> {capturing ? "Capturing…" : "Capture Now"}
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="text-white/40 font-mono text-sm py-6">Loading…</div>
      ) : snaps.length === 0 ? (
        <div className="text-white/35 font-mono text-xs py-3">No snapshots yet.</div>
      ) : (
        <div className="border border-white/5 rounded-sm overflow-hidden">
          <div className="hidden md:grid grid-cols-12 gap-3 px-4 py-2.5 bg-obsidian-800/40 text-[10px] uppercase tracking-[0.2em] font-mono text-white/45">
            <div className="col-span-1">#</div>
            <div className="col-span-5">Captured</div>
            <div className="col-span-3">Holders</div>
            <div className="col-span-3 text-right">Action</div>
          </div>
          {snaps.map((s, i) => (
            <div
              key={s.id}
              className="grid grid-cols-12 gap-3 items-center px-4 py-2.5 border-t border-white/5 hover:bg-white/[0.02] text-sm"
            >
              <div className="col-span-1 font-mono text-white/35 text-xs">{i + 1}</div>
              <div className="col-span-5 font-mono text-white/75 text-xs">{fmtDate(s.captured_at)}</div>
              <div className="col-span-3 font-mono text-white/65 text-xs tabular-nums">{(s.total_holders ?? 0).toLocaleString()}</div>
              <div className="col-span-3 flex justify-end">
                <Button
                  onClick={() => remove(s.id)}
                  disabled={!!deleting[s.id]}
                  variant="outline"
                  className="border-white/10 bg-transparent text-white/50 hover:text-crimson hover:border-crimson/40 h-8 px-2 font-mono text-[10px] uppercase tracking-widest rounded-sm"
                >
                  <Trash2 className="w-3 h-3 mr-1" /> Delete
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ─── Telegram bot controls ──────────────────────────────────────────────────

function TelegramBotSection() {
  const [events, setEvents] = useState([]);            // [{name, label, default_template, vars}, ...]
  const [enabled, setEnabled] = useState(true);        // tg_announcements_enabled
  const [disabledSet, setDisabledSet] = useState(new Set()); // names disabled
  const [templates, setTemplates] = useState({});      // { name: customString }
  const [editing, setEditing] = useState(null);        // currently edited event name
  const [draftTpl, setDraftTpl] = useState("");
  const [savingTpl, setSavingTpl] = useState(false);
  const [savingToggles, setSavingToggles] = useState(false);
  const [customMsg, setCustomMsg] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const [eRes, cRes] = await Promise.all([
        api.get("/admin/telegram/events"),
        api.get("/admin/config"),
      ]);
      const evList = eRes.data?.events || [];
      setEvents(evList);
      const cur = cRes.data?.current || {};
      setEnabled(cur.tg_announcements_enabled !== false);
      setDisabledSet(new Set(cur.tg_event_disabled || []));
      setTemplates(cur.tg_templates || {});
    } catch (err) {
      toast.error("Could not load Telegram settings", {
        description: err?.response?.data?.detail || err?.message,
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const toggleEnabled = async (val) => {
    setSavingToggles(true);
    try {
      await api.patch("/admin/config", { tg_announcements_enabled: val });
      setEnabled(val);
      toast.success(val ? "Announcements enabled" : "Announcements paused");
    } catch (err) {
      toast.error("Save failed", { description: err?.response?.data?.detail || err?.message });
    } finally {
      setSavingToggles(false);
    }
  };

  const toggleEvent = async (name) => {
    const next = new Set(disabledSet);
    if (next.has(name)) next.delete(name); else next.add(name);
    setSavingToggles(true);
    try {
      await api.patch("/admin/config", { tg_event_disabled: Array.from(next) });
      setDisabledSet(next);
    } catch (err) {
      toast.error("Save failed", { description: err?.response?.data?.detail || err?.message });
    } finally {
      setSavingToggles(false);
    }
  };

  const startEditing = (event) => {
    setEditing(event.name);
    setDraftTpl(templates[event.name] ?? event.default_template);
  };

  const saveTemplate = async () => {
    if (!editing) return;
    const event = events.find((e) => e.name === editing);
    const isUnchanged = (templates[editing] ?? event?.default_template) === draftTpl;
    if (isUnchanged) { setEditing(null); return; }

    // If draftTpl matches the default exactly, treat as a reset (drop the override).
    const newTemplates = { ...templates };
    if (event && draftTpl.trim() === event.default_template.trim()) {
      delete newTemplates[editing];
    } else {
      newTemplates[editing] = draftTpl;
    }

    setSavingTpl(true);
    try {
      await api.patch("/admin/config", { tg_templates: newTemplates });
      setTemplates(newTemplates);
      setEditing(null);
      toast.success("Template saved");
    } catch (err) {
      toast.error("Save failed", { description: err?.response?.data?.detail || err?.message });
    } finally {
      setSavingTpl(false);
    }
  };

  const resetTemplate = async (name) => {
    const next = { ...templates };
    delete next[name];
    setSavingTpl(true);
    try {
      await api.patch("/admin/config", { tg_templates: next });
      setTemplates(next);
      if (editing === name) setEditing(null);
      toast.success("Reverted to default");
    } catch (err) {
      toast.error("Reset failed", { description: err?.response?.data?.detail || err?.message });
    } finally {
      setSavingTpl(false);
    }
  };

  const sendCustom = async () => {
    if (!customMsg.trim()) {
      toast.error("Type a message first");
      return;
    }
    setSending(true);
    try {
      await api.post("/admin/telegram/send", { message: customMsg, parse_mode: "Markdown" });
      toast.success("Message sent");
      setCustomMsg("");
    } catch (err) {
      toast.error("Send failed", { description: err?.response?.data?.detail || err?.message });
    } finally {
      setSending(false);
    }
  };

  return (
    <section className="bg-obsidian-900/40 border border-white/5 rounded-sm p-7 mb-8" data-testid="tg-bot-section">
      <SectionHeader
        icon={MessageSquare}
        title="Telegram Bot"
        description="Pause auto-announcements, edit per-event templates, or send a one-off message right now."
      />
      {loading ? (
        <div className="text-sm text-white/40 font-mono">Loading…</div>
      ) : (
        <>
          {/* Master switch */}
          <div className="flex items-center justify-between p-4 rounded-sm border border-white/10 bg-obsidian-950/40 mb-6">
            <div>
              <div className="text-sm text-white font-medium flex items-center gap-2">
                <Power className="w-4 h-4" style={{ color: enabled ? ACCENT : "#ffffff60" }} />
                Auto-announcements
              </div>
              <div className="text-xs text-white/45 mt-0.5">
                Master switch. When off, no scheduled events will post to Telegram (manual sends below still work).
              </div>
            </div>
            <button
              onClick={() => toggleEnabled(!enabled)}
              disabled={savingToggles}
              className="relative w-12 h-6 rounded-full transition-colors flex-shrink-0"
              style={{ backgroundColor: enabled ? ACCENT : "#ffffff20" }}
              aria-label="Toggle announcements"
            >
              <span
                className="absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all"
                style={{ left: enabled ? "calc(100% - 22px)" : "2px" }}
              />
            </button>
          </div>

          {/* Per-event toggle list + edit buttons */}
          <div className="mb-8">
            <div className="text-[10px] uppercase tracking-[0.25em] font-mono text-white/45 mb-3">Events</div>
            <div className="border border-white/5 rounded-sm divide-y divide-white/5">
              {events.map((e) => {
                const isDisabled = disabledSet.has(e.name);
                const hasOverride = templates[e.name] !== undefined;
                return (
                  <div key={e.name} className="px-4 py-3 flex items-center gap-3">
                    <button
                      onClick={() => toggleEvent(e.name)}
                      disabled={savingToggles}
                      className="relative w-10 h-5 rounded-full transition-colors flex-shrink-0"
                      style={{ backgroundColor: !isDisabled ? ACCENT : "#ffffff15" }}
                      aria-label={`Toggle ${e.name}`}
                    >
                      <span
                        className="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all"
                        style={{ left: !isDisabled ? "calc(100% - 18px)" : "2px" }}
                      />
                    </button>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-white truncate">
                        {e.label}
                        {hasOverride && (
                          <span
                            className="ml-2 px-1.5 py-0.5 rounded-sm text-[9px] uppercase tracking-widest font-mono"
                            style={{ backgroundColor: `${ACCENT}20`, color: ACCENT }}
                          >
                            custom
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] font-mono text-white/35 truncate">{e.name}</div>
                    </div>
                    <Button
                      onClick={() => startEditing(e)}
                      variant="outline"
                      className="border-white/10 bg-transparent text-white/70 hover:bg-white/5 h-8 px-3 font-mono text-[10px] uppercase tracking-widest rounded-sm"
                    >
                      <Pen className="w-3 h-3 mr-1.5" /> Edit
                    </Button>
                    {hasOverride && (
                      <Button
                        onClick={() => resetTemplate(e.name)}
                        disabled={savingTpl}
                        variant="outline"
                        className="border-white/10 bg-transparent text-white/50 hover:text-crimson hover:border-crimson/40 h-8 px-2 font-mono text-[10px] uppercase tracking-widest rounded-sm"
                        aria-label="Reset to default"
                      >
                        <RotateCcw className="w-3 h-3" />
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Template editor (inline panel) */}
          {editing && (() => {
            const event = events.find((e) => e.name === editing);
            if (!event) return null;
            return (
              <div className="mb-8 border border-gold/30 rounded-sm p-5 bg-gold/[0.03]">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <div className="text-[10px] uppercase tracking-[0.3em] font-mono mb-1" style={{ color: ACCENT }}>
                      Editing template
                    </div>
                    <div className="text-sm text-white">{event.label} <span className="text-white/35 font-mono text-xs">· {event.name}</span></div>
                  </div>
                  <Button
                    onClick={() => setEditing(null)}
                    variant="ghost"
                    className="text-white/50 hover:text-white h-8 px-3 font-mono text-[10px] uppercase tracking-widest rounded-sm"
                  >
                    Discard
                  </Button>
                </div>
                <textarea
                  value={draftTpl}
                  onChange={(e) => setDraftTpl(e.target.value)}
                  rows={10}
                  className="w-full bg-obsidian-950/80 border border-white/10 text-white font-mono text-xs rounded-sm p-3 focus:outline-none focus:border-gold/40"
                  data-testid="tg-template-editor"
                />
                <div className="mt-2 text-[11px] font-mono text-white/40">
                  Placeholders: {event.vars.map((v) => (
                    <code key={v} className="mx-1 px-1 py-0.5 rounded bg-white/5 text-white/60">{`{${v}}`}</code>
                  ))}
                </div>
                <div className="mt-2 text-[10px] font-mono text-white/30">
                  Markdown supported. Use <code className="text-white/50">\\*</code>, <code className="text-white/50">\\_</code>, <code className="text-white/50">\\#</code>, etc. to escape literals. Empty / matching default = revert.
                </div>
                <div className="mt-4 flex items-center justify-end gap-3">
                  <Button
                    onClick={() => setDraftTpl(event.default_template)}
                    variant="outline"
                    className="border-white/15 bg-transparent text-white h-9 px-4 font-mono text-[11px] uppercase tracking-widest rounded-sm"
                  >
                    <RotateCcw className="w-3 h-3 mr-1.5" /> Load default
                  </Button>
                  <Button
                    onClick={saveTemplate}
                    disabled={savingTpl}
                    className="bg-gold text-obsidian-950 hover:bg-gold-hover font-bold uppercase tracking-widest text-xs rounded-sm h-9 px-5"
                  >
                    <Save className="w-3.5 h-3.5 mr-1.5" />
                    {savingTpl ? "Saving…" : "Save Template"}
                  </Button>
                </div>
              </div>
            );
          })()}

          {/* Custom message sender */}
          <div className="border border-white/10 rounded-sm p-5 bg-obsidian-950/40">
            <div className="text-[10px] uppercase tracking-[0.3em] font-mono mb-3" style={{ color: ACCENT }}>
              Send Custom Message
            </div>
            <textarea
              value={customMsg}
              onChange={(e) => setCustomMsg(e.target.value)}
              rows={5}
              placeholder={"Type a one-off announcement…\nMarkdown is supported. Bypasses all toggles."}
              className="w-full bg-obsidian-950/80 border border-white/10 text-white font-mono text-sm rounded-sm p-3 focus:outline-none focus:border-gold/40 placeholder:text-white/25"
              data-testid="tg-custom-message"
            />
            <div className="mt-3 flex items-center justify-between">
              <div className="text-[11px] font-mono text-white/35">{customMsg.length} chars · max 4096</div>
              <Button
                onClick={sendCustom}
                disabled={sending || !customMsg.trim() || customMsg.length > 4096}
                className="bg-gold text-obsidian-950 hover:bg-gold-hover font-bold uppercase tracking-widest text-xs rounded-sm h-10 px-5"
                data-testid="tg-send-custom"
              >
                <Send className="w-3.5 h-3.5 mr-1.5" />
                {sending ? "Sending…" : "Send Now"}
              </Button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
