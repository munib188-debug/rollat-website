import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ArrowLeft, Wallet, Calendar, Coins, Trash2, ShieldAlert, ShieldCheck,
  Pen, Tag, Timer, PlusCircle, Save, X, Image as ImageIcon, User, Skull, Repeat,
} from "lucide-react";
import { toast } from "sonner";
import { useWallet } from "@solana/wallet-adapter-react";
import { useAuth } from "@/lib/AuthContext";
import { api } from "@/lib/api";
import { isValidSolanaAddress, truncWallet } from "@/lib/walletUtils";
import WalletPicker from "@/components/site/WalletPicker";

const ACCENT = "#FF3366";

const fmtSol = (n) =>
  `${(n ?? 0).toLocaleString("en-US", { maximumFractionDigits: 2 })} SOL`;

// Convert a `<input type="datetime-local">` value (assumed UTC) to ISO 8601.
function localUtcInputToIso(v) {
  if (!v) return null;
  return `${v}:00Z`;
}

// Resize an image File to a 512-px max-side JPEG@0.8 data URL.  Keeps payload
// under the backend's per-entry image cap (~350 KB encoded). Returns a Promise.
function fileToResizedDataUrl(file, maxSide = 512, quality = 0.8) {
  return new Promise((resolve, reject) => {
    if (!file?.type?.startsWith("image/")) {
      reject(new Error("File is not an image"));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Could not decode image"));
      img.onload = () => {
        const ratio = Math.min(1, maxSide / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * ratio));
        const h = Math.max(1, Math.round(img.height * ratio));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        // White background prevents transparent PNGs from going black on JPEG.
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        try {
          resolve(canvas.toDataURL("image/jpeg", quality));
        } catch (err) {
          reject(err);
        }
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

const intervalToSeconds = (value, unit) => {
  const n = Math.max(0, parseInt(value) || 0);
  if (unit === "hours") return n * 3600;
  if (unit === "minutes") return n * 60;
  return n;
};

const formatDuration = (totalSecs) => {
  if (totalSecs < 60) return `${totalSecs}s`;
  if (totalSecs < 3600) return `${Math.floor(totalSecs / 60)}m ${totalSecs % 60}s`;
  const h = Math.floor(totalSecs / 3600);
  const m = Math.floor((totalSecs % 3600) / 60);
  return m ? `${h}h ${m}m` : `${h}h`;
};

export default function DevAdmin() {
  const { publicKey, disconnect } = useWallet();
  const connectedAddr = publicKey?.toBase58() || "";
  const { isAuthenticated, isAdmin, signIn, signingIn, signOut } = useAuth();
  const [pickerOpen, setPickerOpen] = useState(false);

  // Form state
  const [title, setTitle] = useState("");
  const [entryType, setEntryType] = useState("wallet"); // "wallet" | "custom"
  const [walletsRaw, setWalletsRaw] = useState("");
  const [customEntries, setCustomEntries] = useState([]); // [{ tempId, name, image_data_url }]
  const [pot, setPot] = useState("1");
  const [mode, setMode] = useState("single"); // "single" | "elimination"
  const [intervalValue, setIntervalValue] = useState("5");
  const [intervalUnit, setIntervalUnit] = useState("minutes");
  const [isTournament, setIsTournament] = useState(false);
  const [schedMode, setSchedMode] = useState("timer");
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

  const resetForm = () => {
    setTitle("");
    setWalletsRaw("");
    setCustomEntries([]);
    setPot("1");
    setMode("single");
    setIntervalValue("5");
    setIntervalUnit("minutes");
    setIsTournament(false);
    setTimerHours("1");
    setTimerMinutes("0");
    setScheduledAt("");
  };

  const handleSubmit = async () => {
    // Build entries payload based on type.
    let entriesPayload = [];
    if (entryType === "wallet") {
      const wallets = walletsRaw.split(/[\s,;\n]+/).map((w) => w.trim()).filter(Boolean);
      if (wallets.length === 0) { toast.error("Add at least one wallet"); return; }
      const bad = wallets.find((w) => !isValidSolanaAddress(w));
      if (bad) { toast.error("Invalid wallet", { description: `${bad.slice(0, 24)}…` }); return; }
      entriesPayload = wallets.map((w) => ({ wallet: w }));
    } else {
      if (customEntries.length === 0) { toast.error("Add at least one entry"); return; }
      const incomplete = customEntries.find((e) => !e.name?.trim() || !e.image_data_url);
      if (incomplete) { toast.error("Each entry needs a name and a photo"); return; }
      entriesPayload = customEntries.map((e) => ({ name: e.name.trim(), image_data_url: e.image_data_url }));
    }

    const potNum = Number(pot);
    if (!Number.isFinite(potNum) || potNum < 0) { toast.error("Pot must be a non-negative number"); return; }

    let intervalSecs = null;
    if (mode === "elimination") {
      if (entriesPayload.length < 2) { toast.error("Elimination roll needs at least 2 entries"); return; }
      intervalSecs = intervalToSeconds(intervalValue, intervalUnit);
      if (intervalSecs < 5) { toast.error("Interval must be at least 5 seconds"); return; }
    }

    // Last Team Standing requires elimination + custom + 3-20 teams.
    if (isTournament) {
      if (mode !== "elimination" || entryType !== "custom") {
        toast.error("Tournament needs Elimination mode + Custom entries");
        return;
      }
      if (entriesPayload.length < 3 || entriesPayload.length > 20) {
        toast.error("Tournament needs 3–20 teams");
        return;
      }
    }

    let iso;
    if (schedMode === "timer") {
      const totalSecs = Math.max(0, parseInt(timerHours) || 0) * 3600 + Math.max(0, parseInt(timerMinutes) || 0) * 60;
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
        entry_type: entryType,
        mode,
        elimination_interval_secs: intervalSecs,
        entries: entriesPayload,
        pot_sol: potNum,
        scheduled_at: iso,
        is_tournament: isTournament,
      });
      toast.success("Dev roll scheduled");
      resetForm();
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
                <Link to="/admin/system" className="hidden md:inline-flex items-center px-3 h-9 border border-gold/30 hover:border-gold/60 text-gold/80 hover:text-gold rounded-sm font-mono text-[11px] uppercase tracking-widest">
                  System →
                </Link>
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
                Set the entries, the pot, the time.
              </h1>
              <p className="text-white/55">
                Wallet roll, or custom name+photo bracket. Single winner or elimination — your call.
                Dev rolls are stored separately and never affect Hall of Fame or stats.
              </p>
            </div>

            <SetupForm
              title={title} setTitle={setTitle}
              entryType={entryType} setEntryType={setEntryType}
              walletsRaw={walletsRaw} setWalletsRaw={setWalletsRaw}
              customEntries={customEntries} setCustomEntries={setCustomEntries}
              pot={pot} setPot={setPot}
              mode={mode} setMode={setMode}
              intervalValue={intervalValue} setIntervalValue={setIntervalValue}
              intervalUnit={intervalUnit} setIntervalUnit={setIntervalUnit}
              isTournament={isTournament} setIsTournament={setIsTournament}
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
  entryType, setEntryType,
  walletsRaw, setWalletsRaw,
  customEntries, setCustomEntries,
  pot, setPot,
  mode, setMode,
  intervalValue, setIntervalValue,
  intervalUnit, setIntervalUnit,
  isTournament, setIsTournament,
  schedMode, setSchedMode,
  timerHours, setTimerHours,
  timerMinutes, setTimerMinutes,
  scheduledAt, setScheduledAt,
  submitting, onSubmit,
}) {
  const wallets = walletsRaw.split(/[\s,;\n]+/).map((w) => w.trim()).filter(Boolean);
  const validCount = wallets.filter((w) => isValidSolanaAddress(w)).length;
  const invalidCount = wallets.length - validCount;

  const entryCount = entryType === "wallet" ? validCount : customEntries.length;
  const intervalSecs = intervalToSeconds(intervalValue, intervalUnit);
  const totalElimSecs = mode === "elimination" && entryCount > 1 ? (entryCount - 1) * intervalSecs : 0;

  const timerPreview = (() => {
    const totalSecs = Math.max(0, parseInt(timerHours) || 0) * 3600 + Math.max(0, parseInt(timerMinutes) || 0) * 60;
    if (totalSecs < 30) return null;
    return new Date(Date.now() + totalSecs * 1000).toUTCString();
  })();

  return (
    <div className="glass rounded-sm p-7 md:p-10 mb-10" data-testid="dev-admin-form">
      {/* Entry-type tabs */}
      <div className="flex items-center gap-2 mb-6">
        <Tab active={entryType === "wallet"} onClick={() => setEntryType("wallet")} icon={<Wallet className="w-3.5 h-3.5" />} label="Wallet Roll" />
        <Tab active={entryType === "custom"} onClick={() => setEntryType("custom")} icon={<User className="w-3.5 h-3.5" />} label="Custom Roll" />
      </div>

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

        {/* Entries (wallet or custom) */}
        <div className="lg:col-span-3">
          {entryType === "wallet" ? (
            <>
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
                <span className="text-white/30">· each wallet = 1 ticket</span>
              </div>
            </>
          ) : (
            <CustomEntryList entries={customEntries} setEntries={setCustomEntries} />
          )}
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

        {/* Mode + interval */}
        <div className="lg:col-span-2">
          <Label icon={<Repeat className="w-3.5 h-3.5" />} text="Mode" />
          <div className="flex gap-2">
            <Tab active={mode === "single"} onClick={() => setMode("single")} icon={<Tag className="w-3.5 h-3.5" />} label="Single Winner" />
            <Tab active={mode === "elimination"} onClick={() => setMode("elimination")} icon={<Skull className="w-3.5 h-3.5" />} label="Elimination" />
          </div>

          {mode === "elimination" && (
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div>
                <div className="text-[10px] font-mono text-white/40 mb-1">INTERVAL BETWEEN ELIMINATIONS</div>
                <Input
                  value={intervalValue}
                  onChange={(e) => setIntervalValue(e.target.value.replace(/\D/g, ""))}
                  type="number" min="1"
                  className="bg-obsidian-950/80 border-white/10 text-white font-mono h-11 rounded-sm"
                  data-testid="dev-admin-interval-value"
                />
              </div>
              <div>
                <div className="text-[10px] font-mono text-white/40 mb-1">UNIT</div>
                <select
                  value={intervalUnit}
                  onChange={(e) => setIntervalUnit(e.target.value)}
                  className="w-full bg-obsidian-950/80 border border-white/10 text-white font-mono h-11 rounded-sm px-3 focus:outline-none focus:border-white/30"
                  data-testid="dev-admin-interval-unit"
                >
                  <option value="seconds">seconds</option>
                  <option value="minutes">minutes</option>
                  <option value="hours">hours</option>
                </select>
              </div>
              <div className="col-span-2 text-[11px] font-mono text-white/45">
                {entryCount > 1 ? (
                  <>≈ {entryCount - 1} eliminations × {formatDuration(intervalSecs)} = <span style={{ color: ACCENT }}>{formatDuration(totalElimSecs)}</span> total</>
                ) : (
                  <>Add at least 2 entries to estimate total duration.</>
                )}
              </div>

              {/* Last Team Standing tournament toggle — only meaningful when
                  mode=elimination AND entry_type=custom. */}
              {entryType === "custom" && (
                <div className="col-span-2 mt-2 border border-crimson/30 rounded-sm p-3 bg-crimson/[0.04]">
                  <label className="flex items-start gap-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={!!isTournament}
                      onChange={(e) => setIsTournament(e.target.checked)}
                      className="mt-1 accent-crimson"
                      data-testid="dev-admin-is-tournament"
                    />
                    <div>
                      <div className="text-[11px] uppercase tracking-widest font-mono text-crimson">
                        Last Team Standing tournament
                      </div>
                      <div className="text-xs text-white/55 mt-1">
                        Public sign-ups will open. Eliminating a team eliminates its supporters too.
                        Pot splits among the surviving team's backers.
                      </div>
                      <div className="text-[10px] font-mono text-white/35 mt-1">
                        Requires 3–20 teams (custom entries).
                        {isTournament && (entryCount < 3 || entryCount > 20) && (
                          <span className="text-crimson ml-1">
                            · You currently have {entryCount} {entryCount === 1 ? "team" : "teams"}.
                          </span>
                        )}
                      </div>
                    </div>
                  </label>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Schedule */}
        <div className="lg:col-span-3">
          <div className="flex items-center justify-between mb-2">
            <Label icon={<Calendar className="w-3.5 h-3.5" />} text="Schedule" />
            <div className="flex rounded-sm overflow-hidden border border-white/10">
              {[["timer", <Timer key="t" className="w-3 h-3 mr-1" />, "Countdown"], ["datetime", <Calendar key="d" className="w-3 h-3 mr-1" />, "Date & Time"]].map(([m, icon, label]) => (
                <button
                  key={m}
                  onClick={() => setSchedMode(m)}
                  className={`flex items-center px-3 py-1.5 text-[10px] font-mono uppercase tracking-widest transition-colors ${schedMode === m ? "text-obsidian-950 font-bold" : "text-white/40 hover:text-white/70"}`}
                  style={{ backgroundColor: schedMode === m ? ACCENT : "transparent" }}
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
          {submitting ? "Scheduling…" : `Schedule ${mode === "elimination" ? "Elimination" : "Dev"} Roll`}
        </Button>
      </div>
    </div>
  );
}

function Tab({ active, onClick, icon, label }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-sm border font-mono text-[11px] uppercase tracking-widest transition-colors"
      style={{
        borderColor: active ? ACCENT : "#ffffff10",
        backgroundColor: active ? `${ACCENT}15` : "transparent",
        color: active ? ACCENT : "#ffffff80",
      }}
    >
      {icon}{label}
    </button>
  );
}

function CustomEntryList({ entries, setEntries }) {
  const fileInputRef = useRef(null);
  const [pendingName, setPendingName] = useState("");
  const [busy, setBusy] = useState(false);

  const handleFile = async (file) => {
    if (!file) return;
    if (!pendingName.trim()) {
      toast.error("Type a name first, then pick the photo");
      return;
    }
    setBusy(true);
    try {
      const dataUrl = await fileToResizedDataUrl(file, 512, 0.8);
      // Encoded length cap to stay under the backend limit (~350 KB).
      if (dataUrl.length > 340_000) {
        toast.error("Image too large after resize — try a smaller source");
        return;
      }
      setEntries((prev) => [
        ...prev,
        { tempId: crypto.randomUUID(), name: pendingName.trim().slice(0, 60), image_data_url: dataUrl },
      ]);
      setPendingName("");
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (err) {
      toast.error("Could not load image", { description: err?.message || "" });
    } finally {
      setBusy(false);
    }
  };

  const remove = (tempId) => setEntries((prev) => prev.filter((e) => e.tempId !== tempId));
  const renameAt = (tempId, name) =>
    setEntries((prev) => prev.map((e) => e.tempId === tempId ? { ...e, name: name.slice(0, 60) } : e));

  return (
    <div>
      <Label icon={<ImageIcon className="w-3.5 h-3.5" />} text={`Custom Entries (${entries.length})`} />
      <div className="bg-obsidian-950/60 border border-white/10 rounded-sm p-4">
        {/* Add row */}
        <div className="flex flex-col md:flex-row gap-3 items-stretch md:items-end">
          <div className="flex-1">
            <div className="text-[10px] font-mono text-white/40 mb-1">NAME</div>
            <Input
              value={pendingName}
              onChange={(e) => setPendingName(e.target.value.slice(0, 60))}
              placeholder="e.g. Bob"
              className="bg-obsidian-950/80 border-white/10 text-white font-mono h-10 rounded-sm placeholder:text-white/25"
              data-testid="dev-admin-custom-name"
            />
          </div>
          <div>
            <div className="text-[10px] font-mono text-white/40 mb-1">PHOTO</div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(e) => handleFile(e.target.files?.[0])}
              className="hidden"
            />
            <Button
              onClick={() => fileInputRef.current?.click()}
              disabled={busy || !pendingName.trim()}
              className="font-bold uppercase tracking-widest text-[11px] rounded-sm h-10 px-4"
              style={{ backgroundColor: ACCENT, color: "#0A0D0B" }}
              data-testid="dev-admin-custom-add"
            >
              <PlusCircle className="w-3.5 h-3.5 mr-1.5" />
              {busy ? "Adding…" : "Add Entry"}
            </Button>
          </div>
        </div>
        <div className="text-[11px] font-mono text-white/35 mt-2">
          Type a name, pick a photo. Photos are resized to 512px and compressed before upload.
        </div>

        {/* Existing entries */}
        {entries.length > 0 && (
          <div className="mt-5 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {entries.map((e) => (
              <div key={e.tempId} className="border border-white/10 bg-obsidian-900/60 rounded-sm p-2 group relative">
                <div className="aspect-square w-full overflow-hidden rounded-sm bg-obsidian-950 mb-2">
                  <img src={e.image_data_url} alt={e.name} className="w-full h-full object-cover" />
                </div>
                <Input
                  value={e.name}
                  onChange={(ev) => renameAt(e.tempId, ev.target.value)}
                  className="bg-obsidian-950/80 border-white/10 text-white font-mono h-8 rounded-sm text-xs"
                />
                <button
                  onClick={() => remove(e.tempId)}
                  className="absolute top-1 right-1 w-6 h-6 rounded-sm bg-obsidian-950/80 border border-white/10 text-white/60 hover:text-crimson hover:border-crimson/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  aria-label="Remove entry"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}
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
  const cancellable = roll.phase === "scheduled" || roll.phase === "spinning";
  const isWalletRoll = (roll.entry_type || "wallet") === "wallet";
  const isElim = roll.mode === "elimination";

  const entryCount = (roll.entries?.length ?? 0) || (roll.wallets?.length ?? 0);
  const survivorCount = roll.survivors?.length ?? entryCount;
  const eliminatedCount = roll.eliminated?.length ?? 0;

  const handleEdit = () => {
    setEditPot(roll.pot_sol?.toString() || "");
    setAddWallets("");
    setEditing(true);
  };

  const handleSave = async () => {
    const payload = {};
    if (isWalletRoll) {
      const newWallets = addWallets.split(/[\s,;\n]+/).map((w) => w.trim()).filter(Boolean);
      if (newWallets.length > 0) payload.wallets_to_add = newWallets;
    }
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
      <div className="px-6 py-4 border-b border-white/5 flex items-center justify-between flex-wrap gap-2">
        <div className="text-[10px] uppercase tracking-[0.3em] font-mono" style={{ color: ACCENT }}>
          Active Roll · {roll.phase} · {isWalletRoll ? "wallet" : "custom"}{isElim ? " · elimination" : ""}{roll.title ? ` · ${roll.title}` : ""}
        </div>
        <div className="flex items-center gap-2">
          {editable && !editing && isWalletRoll && (
            <Button
              onClick={handleEdit}
              variant="outline"
              className="border-white/15 hover:border-white/30 text-white h-8 px-3 font-mono text-[11px] uppercase tracking-widest rounded-sm"
              data-testid="dev-admin-edit"
            >
              <PlusCircle className="w-3 h-3 mr-1.5" /> Edit
            </Button>
          )}
          {cancellable && (
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

      <div className="p-6 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
        <Stat label="Pot" value={fmtSol(roll.pot_sol)} />
        <Stat label="Entries" value={entryCount} />
        {isElim ? (
          <>
            <Stat label="Survivors" value={`${survivorCount} / ${entryCount}`} />
            <Stat label="Eliminated" value={eliminatedCount} />
          </>
        ) : (
          <Stat label="Scheduled" value={new Date(roll.scheduled_at).toUTCString()} />
        )}
        {roll.winner && <Stat label="Winner" value={isWalletRoll ? truncWallet(roll.winner) : roll.winner} accent />}
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
                  <span className="text-white/30">· new total: {entryCount + validNew}</span>
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
      {history.map((r) => {
        const isWalletRoll = (r.entry_type || "wallet") === "wallet";
        const isElim = r.mode === "elimination";
        const isTour = !!r.is_tournament;
        const winnerLabel = r.winner ? (isWalletRoll ? truncWallet(r.winner) : r.winner) : null;
        return (
          <div key={r.id} className="grid grid-cols-12 gap-3 px-6 py-3 border-b border-white/5 last:border-b-0 items-center text-sm">
            <div className="col-span-2 font-mono text-white/40 uppercase text-[10px] tracking-widest">
              {r.phase}{isElim ? " · elim" : ""}{isTour ? " · tournament" : ""}
            </div>
            <div className="col-span-2 font-mono text-white/80">{fmtSol(r.pot_sol)}</div>
            <div className="col-span-2 font-mono text-white/55 text-xs">
              {isWalletRoll ? "wallet" : "custom"} · {r.entries?.length ?? r.wallets?.length ?? 0}
            </div>
            <div className="col-span-2 font-mono text-white/60 text-xs">{new Date(r.scheduled_at).toUTCString().slice(5, 22)}</div>
            <div className="col-span-4 font-mono text-right">
              {winnerLabel ? (
                <span style={{ color: ACCENT }}>{winnerLabel}</span>
              ) : (
                <span className="text-white/30">—</span>
              )}
            </div>
          </div>
        );
      })}
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
