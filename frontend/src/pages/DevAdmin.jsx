import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowLeft, Wallet, Calendar, Coins, Trash2, ShieldAlert, ShieldCheck, Pen, Tag, Timer, PlusCircle, Save, X } from "lucide-react";
import { toast } from "sonner";
import { useWallet } from "@solana/wallet-adapter-react";
import { useAuth } from "@/lib/AuthContext";
import { api } from "@/lib/api";
import { isValidSolanaAddress, truncWallet } from "@/lib/walletUtils";
import WalletPicker from "@/components/site/WalletPicker";

const ACCENT = "#FF3366";

const fmtSol = (n) =>
  `${(n ?? 0).toLocaleString("en-US", { maximumFractionDigits: 2 })} SOL`;

// Convert a `<input type="datetime-local">` value (assumed entered in UTC, since
// the form labels it as UTC) to an ISO 8601 string the backend will accept.
function localUtcInputToIso(v) {
  if (!v) return null;
  // Browser gives us "YYYY-MM-DDTHH:MM" with no timezone. We label the field as
  // UTC and append Z so the backend treats it as UTC, not local time.
  return `${v}:00Z`;
}

export default function DevAdmin() {
  const { publicKey, disconnect } = useWallet();
  const connectedAddr = publicKey?.toBase58() || "";
  const { isAuthenticated, isAdmin, signIn, signingIn, signOut } = useAuth();
  const [pickerOpen, setPickerOpen] = useState(false);

  const [title, setTitle] = useState("");
  const [walletsRaw, setWalletsRaw] = useState("");
  const [pot, setPot] = useState("1");
  const [schedMode, setSchedMode] = useState("timer"); // "timer" | "datetime"
  const [timerHours, setTimerHours] = useState("1");
  const [timerMinutes, setTimerMinutes] = useState("0");
  const [scheduledAt, setScheduledAt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [current, setCurrent] = useState(null);
  const [history, setHistory] = useState([]);
  const [loadingList, setLoadingList] = useState(false);

  const refresh = async () => {
    setLoadingList(true);
    try {
      const [cur, hist] = await Promise.all([
        api.get("/dev/roll/current").then((r) => r.data).catch(() => null),
        isAdmin
          ? api.get("/dev/rolls").then((r) => r.data).catch(() => [])
          : Promise.resolve([]),
      ]);
      setCurrent(cur);
      setHistory(Array.isArray(hist) ? hist : []);
    } finally {
      setLoadingList(false);
    }
  };

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  const handleSignIn = async () => {
    try {
      await signIn();
      toast.success("Signed in", { description: "Wallet ownership verified." });
    } catch (e) {
      toast.error("Sign-in failed", { description: e?.message || "Please try again." });
    }
  };

  const handleSubmit = async () => {
    const wallets = walletsRaw
      .split(/[\s,;\n]+/)
      .map((w) => w.trim())
      .filter(Boolean);
    if (wallets.length === 0) {
      toast.error("Add at least one wallet");
      return;
    }
    const bad = wallets.find((w) => !isValidSolanaAddress(w));
    if (bad) {
      toast.error("Invalid wallet", { description: `${bad.slice(0, 24)}…` });
      return;
    }
    const potNum = Number(pot);
    if (!Number.isFinite(potNum) || potNum < 0) {
      toast.error("Pot must be a non-negative number");
      return;
    }
    let iso;
    if (schedMode === "timer") {
      const h = Math.max(0, parseInt(timerHours) || 0);
      const m = Math.max(0, parseInt(timerMinutes) || 0);
      const totalSecs = h * 3600 + m * 60;
      if (totalSecs < 30) { toast.error("Timer must be at least 30 seconds"); return; }
      iso = new Date(Date.now() + totalSecs * 1000).toISOString();
    } else {
      iso = localUtcInputToIso(scheduledAt);
      if (!iso) { toast.error("Pick a UTC date & time for the spin"); return; }
    }

    setSubmitting(true);
    try {
      await api.post("/dev/roll", {
        title: title.trim() || undefined,
        wallets,
        pot_sol: potNum,
        scheduled_at: iso,
      });
      toast.success("Dev roll scheduled");
      setTitle("");
      setWalletsRaw("");
      setPot("1");
      setTimerHours("1");
      setTimerMinutes("0");
      setScheduledAt("");
      await refresh();
    } catch (err) {
      const detail = err?.response?.data?.detail;
      toast.error("Schedule failed", { description: detail || err?.message || "Network error" });
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancel = async (id) => {
    try {
      await api.delete(`/dev/roll/${id}`);
      toast.success("Roll cancelled");
      await refresh();
    } catch (err) {
      const detail = err?.response?.data?.detail;
      toast.error("Cancel failed", { description: detail || err?.message });
    }
  };

  return (
    <div className="min-h-screen bg-obsidian-950 grain felt-bg" data-testid="dev-admin-page">
      <header className="sticky top-0 z-40 glass border-b border-white/5">
        <div className="max-w-[1400px] mx-auto px-6 md:px-12 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2.5 group">
            <ArrowLeft className="w-4 h-4 text-white/50 group-hover:text-crimson" />
            <div className="w-8 h-8 rounded-full roulette-wheel" />
            <span className="font-display font-black text-xl tracking-tight">$ROLLAT</span>
            <span
              className="hidden md:inline text-[10px] uppercase tracking-[0.25em] font-mono border px-2 py-1 rounded-sm ml-2"
              style={{ color: ACCENT, borderColor: `${ACCENT}55` }}
            >
              DEV ROLL · ADMIN
            </span>
          </Link>
          <div className="flex items-center gap-2">
            {isAdmin && (
              <>
                <Link to="/guest" className="hidden md:inline-flex items-center px-3 h-9 border border-white/10 hover:border-white/30 text-white/60 hover:text-white rounded-sm font-mono text-[11px] uppercase tracking-widest">
                  Guest Roll →
                </Link>
                <Link to="/admin/payouts" className="hidden md:inline-flex items-center px-3 h-9 border border-gold/30 hover:border-gold/60 text-gold/80 hover:text-gold rounded-sm font-mono text-[11px] uppercase tracking-widest">
                  Payouts →
                </Link>
              </>
            )}
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
                onClick={() => setPickerOpen(true)}
                className="bg-white text-obsidian-950 hover:bg-white/90 h-9 px-4 font-mono text-[11px] uppercase tracking-widest rounded-sm font-bold"
              >
                <Wallet className="w-3.5 h-3.5 mr-2" /> Connect
              </Button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-[1100px] mx-auto px-6 md:px-12 py-10 md:py-14">
        {!connectedAddr && (
          <Gate
            title="Connect a wallet to continue"
            description="The Dev Roll setup is gated by an on-chain wallet allowlist. Connect to begin."
            action={<Button onClick={() => setPickerOpen(true)} className="bg-white text-obsidian-950 font-bold uppercase tracking-widest text-xs rounded-sm h-12 px-6"><Wallet className="w-4 h-4 mr-2" /> Connect Wallet</Button>}
          />
        )}

        {connectedAddr && !isAuthenticated && (
          <Gate
            title="Sign a message to verify ownership"
            description="Sign-in proves you control this wallet. No transaction is broadcast."
            action={
              <Button
                onClick={handleSignIn}
                disabled={signingIn}
                className="bg-white text-obsidian-950 font-bold uppercase tracking-widest text-xs rounded-sm h-12 px-6"
              >
                <Pen className="w-4 h-4 mr-2" />
                {signingIn ? "Signing…" : "Sign In"}
              </Button>
            }
          />
        )}

        {connectedAddr && isAuthenticated && !isAdmin && (
          <Gate
            danger
            title="Admin only"
            description={`This wallet (${truncWallet(connectedAddr)}) is not on the admin allowlist. Add it to ADMIN_WALLETS in the backend env to enable Dev Roll.`}
          />
        )}

        {connectedAddr && isAuthenticated && isAdmin && (
          <>
            <div className="mb-10">
              <div className="text-[10px] uppercase tracking-[0.3em] font-mono mb-2" style={{ color: ACCENT }}>
                Schedule a Dev Roll
              </div>
              <h1 className="font-display font-black text-3xl md:text-4xl tracking-tighter mb-2">
                Set the wallets, the pot, the time.
              </h1>
              <p className="text-white/55">
                Each wallet gets one ticket. Winner is chosen uniformly at random when the
                scheduled UTC time arrives. Dev rolls are stored separately — they never affect
                Hall of Fame or stats.
              </p>
            </div>

            <SetupForm
              title={title} setTitle={setTitle}
              walletsRaw={walletsRaw} setWalletsRaw={setWalletsRaw}
              pot={pot} setPot={setPot}
              schedMode={schedMode} setSchedMode={setSchedMode}
              timerHours={timerHours} setTimerHours={setTimerHours}
              timerMinutes={timerMinutes} setTimerMinutes={setTimerMinutes}
              scheduledAt={scheduledAt} setScheduledAt={setScheduledAt}
              submitting={submitting} onSubmit={handleSubmit}
            />

            <CurrentRoll roll={current} onCancel={handleCancel} onRefresh={refresh} />

            <HistoryList history={history} loading={loadingList} />
          </>
        )}
      </main>

      <WalletPicker open={pickerOpen} onClose={() => setPickerOpen(false)} />
    </div>
  );
}

function Gate({ title, description, action, danger }) {
  return (
    <div className="glass rounded-sm p-10 md:p-14 text-center" data-testid="dev-admin-gate">
      <div className="mx-auto w-12 h-12 rounded-sm flex items-center justify-center mb-5"
        style={{ backgroundColor: danger ? "#FF336622" : "#ffffff10" }}
      >
        {danger
          ? <ShieldAlert className="w-6 h-6" style={{ color: ACCENT }} />
          : <ShieldCheck className="w-6 h-6 text-white/70" />}
      </div>
      <h2 className="font-display font-black text-2xl md:text-3xl tracking-tighter mb-3">{title}</h2>
      <p className="text-white/55 max-w-xl mx-auto mb-6">{description}</p>
      {action && <div className="flex justify-center">{action}</div>}
    </div>
  );
}

function SetupForm({
  title, setTitle,
  walletsRaw, setWalletsRaw,
  pot, setPot,
  schedMode, setSchedMode,
  timerHours, setTimerHours,
  timerMinutes, setTimerMinutes,
  scheduledAt, setScheduledAt,
  submitting, onSubmit,
}) {
  const wallets = walletsRaw.split(/[\s,;\n]+/).map((w) => w.trim()).filter(Boolean);
  const validCount = wallets.filter((w) => isValidSolanaAddress(w)).length;
  const invalidCount = wallets.length - validCount;

  // Live preview of the computed spin time for the timer mode
  const timerPreview = (() => {
    const h = Math.max(0, parseInt(timerHours) || 0);
    const m = Math.max(0, parseInt(timerMinutes) || 0);
    const totalSecs = h * 3600 + m * 60;
    if (totalSecs < 30) return null;
    return new Date(Date.now() + totalSecs * 1000).toUTCString();
  })();

  return (
    <div className="glass rounded-sm p-7 md:p-10 mb-10" data-testid="dev-admin-form">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Title */}
        <div className="lg:col-span-3">
          <Label icon={<Tag className="w-3.5 h-3.5" />} text="Roll Title (optional)" />
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value.slice(0, 60))}
            placeholder="e.g. Community Giveaway #3"
            maxLength={60}
            className="bg-obsidian-950/80 border-white/10 text-white font-mono h-11 rounded-sm placeholder:text-white/25"
            data-testid="dev-admin-title"
          />
          <div className="text-[11px] font-mono text-white/35 mt-2">{title.length}/60</div>
        </div>

        {/* Wallet Pool */}
        <div className="lg:col-span-3">
          <Label icon={<Wallet className="w-3.5 h-3.5" />} text="Wallet Pool" />
          <textarea
            value={walletsRaw}
            onChange={(e) => setWalletsRaw(e.target.value)}
            rows={8}
            placeholder={"Paste wallet addresses, one per line\n(or comma / space separated)"}
            className="w-full bg-obsidian-950/80 border border-white/10 text-white placeholder:text-white/30 font-mono text-sm rounded-sm p-3 focus:outline-none focus:border-white/30"
            data-testid="dev-admin-wallets"
          />
          <div className="mt-2 flex items-center gap-3 text-[11px] font-mono uppercase tracking-widest text-white/45">
            <span style={{ color: validCount ? ACCENT : undefined }}>{validCount} valid</span>
            {invalidCount > 0 && <span className="text-crimson">· {invalidCount} invalid</span>}
            <span className="text-white/30">· each wallet = 1 ticket · uniform random</span>
          </div>
        </div>

        {/* Pot */}
        <div>
          <Label icon={<Coins className="w-3.5 h-3.5" />} text="Announced Pot (SOL)" />
          <Input
            value={pot}
            onChange={(e) => setPot(e.target.value)}
            type="number" min="0" step="0.01" placeholder="1.0"
            className="bg-obsidian-950/80 border-white/10 text-white font-mono h-11 rounded-sm"
            data-testid="dev-admin-pot"
          />
          <div className="text-[11px] font-mono text-white/35 mt-2">Display only — settle payment outside the app.</div>
        </div>

        {/* Schedule — timer or datetime toggle */}
        <div className="lg:col-span-2">
          <div className="flex items-center justify-between mb-2">
            <Label icon={<Calendar className="w-3.5 h-3.5" />} text="Schedule" />
            <div className="flex rounded-sm overflow-hidden border border-white/10">
              {[["timer", <Timer className="w-3 h-3 mr-1" />, "Countdown"], ["datetime", <Calendar className="w-3 h-3 mr-1" />, "Date & Time"]].map(([mode, icon, label]) => (
                <button
                  key={mode}
                  onClick={() => setSchedMode(mode)}
                  className={`flex items-center px-3 py-1.5 text-[10px] font-mono uppercase tracking-widest transition-colors ${schedMode === mode ? "text-obsidian-950 font-bold" : "text-white/40 hover:text-white/70"}`}
                  style={{ backgroundColor: schedMode === mode ? ACCENT : "transparent" }}
                >
                  {icon}{label}
                </button>
              ))}
            </div>
          </div>

          {schedMode === "timer" ? (
            <div>
              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <div className="text-[10px] font-mono text-white/40 mb-1">HOURS</div>
                  <Input
                    value={timerHours}
                    onChange={(e) => setTimerHours(e.target.value.replace(/\D/g, ""))}
                    type="number" min="0" max="72" placeholder="1"
                    className="bg-obsidian-950/80 border-white/10 text-white font-mono h-11 rounded-sm text-center text-lg"
                    data-testid="dev-admin-timer-hours"
                  />
                </div>
                <span className="text-2xl text-white/30 mt-4">:</span>
                <div className="flex-1">
                  <div className="text-[10px] font-mono text-white/40 mb-1">MINUTES</div>
                  <Input
                    value={timerMinutes}
                    onChange={(e) => setTimerMinutes(e.target.value.replace(/\D/g, ""))}
                    type="number" min="0" max="59" placeholder="0"
                    className="bg-obsidian-950/80 border-white/10 text-white font-mono h-11 rounded-sm text-center text-lg"
                    data-testid="dev-admin-timer-minutes"
                  />
                </div>
              </div>
              <div className="text-[11px] font-mono text-white/35 mt-2">
                {timerPreview ? <>Spins at: <span style={{ color: ACCENT }}>{timerPreview}</span></> : "Enter a duration above 30 seconds"}
              </div>
            </div>
          ) : (
            <div>
              <Input
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
                type="datetime-local"
                className="bg-obsidian-950/80 border-white/10 text-white font-mono h-11 rounded-sm"
                data-testid="dev-admin-time"
              />
              <div className="text-[11px] font-mono text-white/35 mt-2">Treated as UTC. Spin auto-fires at this exact moment.</div>
            </div>
          )}
        </div>
      </div>

      <div className="mt-7 flex justify-end">
        <Button
          onClick={onSubmit}
          disabled={submitting}
          className="font-bold uppercase tracking-widest text-xs rounded-sm h-12 px-6"
          style={{ backgroundColor: ACCENT, color: "#0A0D0B" }}
          data-testid="dev-admin-submit"
        >
          {submitting ? "Scheduling…" : "Schedule Dev Roll"}
        </Button>
      </div>
    </div>
  );
}

function Label({ icon, text }) {
  return (
    <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.25em] font-mono mb-2" style={{ color: ACCENT }}>
      {icon}
      {text}
    </div>
  );
}

function CurrentRoll({ roll, onCancel, onRefresh }) {
  const [editing, setEditing] = useState(false);
  const [addWallets, setAddWallets] = useState("");
  const [editPot, setEditPot] = useState("");
  const [saving, setSaving] = useState(false);

  if (!roll) return null;
  const editable = roll.phase === "scheduled";

  const handleEdit = () => {
    setEditPot(roll.pot_sol?.toString() || "");
    setAddWallets("");
    setEditing(true);
  };

  const handleSave = async () => {
    const payload = {};
    const newWallets = addWallets.split(/[\s,;\n]+/).map((w) => w.trim()).filter(Boolean);
    if (newWallets.length > 0) payload.wallets_to_add = newWallets;
    const potNum = Number(editPot);
    if (editPot && Number.isFinite(potNum) && potNum !== roll.pot_sol) payload.pot_sol = potNum;
    if (!payload.wallets_to_add && payload.pot_sol === undefined) {
      setEditing(false); return;
    }
    setSaving(true);
    try {
      await api.patch(`/dev/roll/${roll.id}`, payload);
      toast.success("Roll updated");
      setEditing(false);
      await onRefresh();
    } catch (err) {
      toast.error("Update failed", { description: err?.response?.data?.detail || err?.message });
    } finally {
      setSaving(false);
    }
  };

  const newWalletsPreview = addWallets.split(/[\s,;\n]+/).map((w) => w.trim()).filter(Boolean);
  const validNew = newWalletsPreview.filter((w) => isValidSolanaAddress(w)).length;
  const invalidNew = newWalletsPreview.length - validNew;

  return (
    <div className="bg-obsidian-900/40 border border-white/5 rounded-sm mb-10" data-testid="dev-admin-current">
      <div className="px-6 py-4 border-b border-white/5 flex items-center justify-between">
        <div className="text-[10px] uppercase tracking-[0.3em] font-mono" style={{ color: ACCENT }}>
          Active Roll · {roll.phase}{roll.title ? ` · ${roll.title}` : ""}
        </div>
        <div className="flex items-center gap-2">
          {editable && !editing && (
            <Button
              onClick={handleEdit}
              variant="outline"
              className="border-white/15 hover:border-white/30 text-white h-8 px-3 font-mono text-[11px] uppercase tracking-widest rounded-sm"
              data-testid="dev-admin-edit"
            >
              <PlusCircle className="w-3 h-3 mr-1.5" /> Edit
            </Button>
          )}
          {editable && (
            <Button
              onClick={() => onCancel(roll.id)}
              variant="outline"
              className="border-white/15 hover:border-crimson/40 text-white h-8 px-3 font-mono text-[11px] uppercase tracking-widest rounded-sm"
              data-testid="dev-admin-cancel"
            >
              <Trash2 className="w-3 h-3 mr-1.5" /> Cancel
            </Button>
          )}
        </div>
      </div>

      <div className="p-6 grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
        <Stat label="Pot" value={fmtSol(roll.pot_sol)} />
        <Stat label="Wallets" value={roll.wallets?.length ?? 0} />
        <Stat label="Scheduled" value={new Date(roll.scheduled_at).toUTCString()} />
        {roll.winner && <Stat label="Winner" value={truncWallet(roll.winner)} accent />}
      </div>

      {editing && (
        <div className="border-t border-white/5 px-6 py-6" data-testid="dev-admin-edit-panel">
          <div className="text-[10px] uppercase tracking-[0.3em] font-mono mb-4" style={{ color: ACCENT }}>
            Edit Scheduled Roll
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2">
              <Label icon={<PlusCircle className="w-3.5 h-3.5" />} text="Add Wallets (appended to pool)" />
              <textarea
                value={addWallets}
                onChange={(e) => setAddWallets(e.target.value)}
                rows={4}
                placeholder={"Paste new wallet addresses to add\n(existing wallets are kept)"}
                className="w-full bg-obsidian-950/80 border border-white/10 text-white placeholder:text-white/25 font-mono text-sm rounded-sm p-3 focus:outline-none focus:border-white/30"
                data-testid="dev-admin-add-wallets"
              />
              {newWalletsPreview.length > 0 && (
                <div className="mt-1.5 flex items-center gap-3 text-[11px] font-mono uppercase tracking-widest text-white/45">
                  <span style={{ color: validNew ? ACCENT : undefined }}>+{validNew} valid</span>
                  {invalidNew > 0 && <span className="text-crimson">· {invalidNew} invalid</span>}
                  <span className="text-white/30">· new total: {(roll.wallets?.length ?? 0) + validNew}</span>
                </div>
              )}
            </div>
            <div>
              <Label icon={<Coins className="w-3.5 h-3.5" />} text="Update Pot (SOL)" />
              <Input
                value={editPot}
                onChange={(e) => setEditPot(e.target.value)}
                type="number" min="0" step="0.01"
                className="bg-obsidian-950/80 border-white/10 text-white font-mono h-11 rounded-sm"
                data-testid="dev-admin-edit-pot"
              />
              <div className="text-[11px] font-mono text-white/35 mt-2">Leave unchanged to keep current.</div>
            </div>
          </div>
          <div className="mt-4 flex items-center justify-end gap-3">
            <Button
              onClick={() => setEditing(false)}
              variant="ghost"
              className="text-white/50 hover:text-white h-9 px-4 font-mono text-[11px] uppercase tracking-widest rounded-sm"
            >
              <X className="w-3 h-3 mr-1.5" /> Discard
            </Button>
            <Button
              onClick={handleSave}
              disabled={saving}
              className="font-bold uppercase tracking-widest text-xs rounded-sm h-9 px-5"
              style={{ backgroundColor: ACCENT, color: "#0A0D0B" }}
              data-testid="dev-admin-save"
            >
              <Save className="w-3.5 h-3.5 mr-1.5" />
              {saving ? "Saving…" : "Save Changes"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function HistoryList({ history, loading }) {
  return (
    <div className="bg-obsidian-900/40 border border-white/5 rounded-sm" data-testid="dev-admin-history">
      <div className="px-6 py-4 border-b border-white/5 flex items-center justify-between">
        <div className="text-[10px] uppercase tracking-[0.3em] font-mono" style={{ color: ACCENT }}>
          History · last 50
        </div>
        {loading && <span className="text-xs text-white/40 font-mono">loading…</span>}
      </div>
      {history.length === 0 && (
        <div className="px-6 py-10 text-center text-white/40 text-sm">No dev rolls yet.</div>
      )}
      {history.map((r) => (
        <div key={r.id} className="grid grid-cols-12 gap-3 px-6 py-3 border-b border-white/5 last:border-b-0 items-center text-sm">
          <div className="col-span-2 font-mono text-white/40 uppercase text-[10px] tracking-widest">{r.phase}</div>
          <div className="col-span-3 font-mono text-white/80">{fmtSol(r.pot_sol)}</div>
          <div className="col-span-3 font-mono text-white/60 text-xs">{new Date(r.scheduled_at).toUTCString()}</div>
          <div className="col-span-4 font-mono text-right">
            {r.winner ? (
              <span style={{ color: ACCENT }}>{truncWallet(r.winner)}</span>
            ) : (
              <span className="text-white/30">—</span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function Stat({ label, value, accent }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.25em] font-mono text-white/40 mb-1">{label}</div>
      <div className="font-mono text-base text-white" style={{ color: accent ? ACCENT : undefined }}>{value}</div>
    </div>
  );
}
