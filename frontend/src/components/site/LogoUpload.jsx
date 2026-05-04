import { useRef, useState } from "react";
import { Upload, X, Link as LinkIcon, ImageIcon } from "lucide-react";
import { Input } from "@/components/ui/input";

const ACCENT = "#A855F7";
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB hard cap before compression

/**
 * Logo input with drag-and-drop file upload.
 * Compresses to a 256×256 JPEG data URL client-side.
 *
 * Props:
 *   value      string|null       — current logo (data URL or http(s) URL)
 *   onChange   (string|null)     — emits the new value
 *   compact    boolean           — render a smaller dropzone for inline use
 */
export default function LogoUpload({ value, onChange, compact = false }) {
  const [mode, setMode] = useState("upload"); // upload | url
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef(null);

  const handleFile = async (file) => {
    setError(null);
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Pick an image file (PNG, JPG, GIF, WEBP).");
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      setError(`Too big — max ${(MAX_FILE_SIZE / 1024 / 1024).toFixed(0)} MB.`);
      return;
    }
    setBusy(true);
    try {
      const dataUrl = await compressToDataUrl(file);
      onChange(dataUrl);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("[LogoUpload] compress failed:", e);
      setError("Couldn't read that image. Try a different file.");
    } finally {
      setBusy(false);
    }
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer?.files?.[0];
    handleFile(file);
  };

  const clear = () => {
    onChange(null);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // ---- Has a value: show preview ----
  if (value) {
    return (
      <div className={`flex items-center gap-3 rounded-sm border bg-obsidian-900/40 ${compact ? "p-1.5" : "p-3"}`} style={{ borderColor: "#ffffff15" }}>
        <img
          src={value}
          alt=""
          className={`${compact ? "w-9 h-9" : "w-12 h-12"} rounded-sm object-cover shrink-0 border border-white/10`}
        />
        <div className="flex-1 min-w-0">
          <div className="text-xs text-white/65 font-mono truncate">
            {value.startsWith("data:") ? "Uploaded image" : value}
          </div>
          <div className="text-[10px] uppercase tracking-widest font-mono text-white/35 mt-0.5">
            {value.startsWith("data:") ? `~${Math.round((value.length * 0.75) / 1024)} KB` : "external URL"}
          </div>
        </div>
        <button
          type="button"
          onClick={clear}
          className="p-1.5 -m-1.5 text-white/40 hover:text-crimson shrink-0"
          aria-label="Remove logo"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    );
  }

  // ---- URL paste mode ----
  if (mode === "url") {
    return (
      <div>
        <Input
          autoFocus
          placeholder="https://… (PNG/JPG link)"
          onBlur={(e) => {
            const v = e.target.value.trim();
            if (v) onChange(v);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              const v = e.currentTarget.value.trim();
              if (v) onChange(v);
            }
          }}
        />
        <button
          type="button"
          onClick={() => { setMode("upload"); setError(null); }}
          className="mt-1.5 text-[10px] uppercase tracking-widest font-mono text-white/40 hover:text-white"
        >
          ← back to upload
        </button>
      </div>
    );
  }

  // ---- Upload mode (empty) ----
  return (
    <div>
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={`w-full flex items-center justify-center gap-2 rounded-sm border-2 border-dashed transition-colors ${compact ? "px-3 py-2" : "px-4 py-5"} ${
          dragOver
            ? "bg-white/[0.04]"
            : "border-white/10 hover:border-white/25 bg-obsidian-900/30"
        }`}
        style={{ borderColor: dragOver ? ACCENT : undefined, color: dragOver ? ACCENT : "#ffffff70" }}
        disabled={busy}
      >
        {busy ? (
          <>
            <ImageIcon className="w-4 h-4 animate-pulse" />
            <span className="text-xs font-mono uppercase tracking-widest">Processing…</span>
          </>
        ) : (
          <>
            <Upload className="w-4 h-4" />
            <span className={`font-mono uppercase tracking-widest ${compact ? "text-[10px]" : "text-xs"}`}>
              {compact ? "Upload logo" : "Drop logo here, or click to upload"}
            </span>
          </>
        )}
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => handleFile(e.target.files?.[0])}
      />
      {error && (
        <div className="mt-1.5 text-[11px] text-crimson font-mono">{error}</div>
      )}
      {!compact && (
        <button
          type="button"
          onClick={() => setMode("url")}
          className="mt-2 inline-flex items-center gap-1 text-[10px] uppercase tracking-widest font-mono text-white/40 hover:text-white"
        >
          <LinkIcon className="w-3 h-3" /> or paste a URL
        </button>
      )}
    </div>
  );
}

/**
 * Compress an image File to a 256×256 JPEG data URL using cover-fit.
 * Typical output: 25–60 KB (≈ 35–85 KB base64 string).
 */
async function compressToDataUrl(file, maxDim = 256, quality = 0.85) {
  // Prefer createImageBitmap when available (fast, off-main-thread decode).
  let source;
  try {
    source = await createImageBitmap(file);
  } catch {
    // Fallback for older browsers via FileReader → Image
    source = await loadImageViaFileReader(file);
  }

  const canvas = document.createElement("canvas");
  canvas.width = maxDim;
  canvas.height = maxDim;
  const ctx = canvas.getContext("2d");

  // Fill background (matters for transparent PNGs since we encode to JPEG)
  ctx.fillStyle = "#0A0D0B";
  ctx.fillRect(0, 0, maxDim, maxDim);

  // Cover-fit centered crop
  const sw = source.width;
  const sh = source.height;
  const scale = Math.max(maxDim / sw, maxDim / sh);
  const dw = sw * scale;
  const dh = sh * scale;
  const dx = (maxDim - dw) / 2;
  const dy = (maxDim - dh) / 2;

  ctx.drawImage(source, dx, dy, dw, dh);

  return canvas.toDataURL("image/jpeg", quality);
}

function loadImageViaFileReader(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
