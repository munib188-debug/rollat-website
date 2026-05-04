import { clsx } from "clsx";
import { twMerge } from "tailwind-merge"

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

/**
 * Sanitize a user-supplied URL before assigning to <a href>. Allows only
 * http(s) and mailto. Anything else (javascript:, data:, vbscript:, etc.)
 * is returned as undefined so React will omit the href attribute entirely.
 */
export function safeHref(url) {
  if (typeof url !== "string") return undefined;
  const trimmed = url.trim();
  if (!trimmed) return undefined;
  const lower = trimmed.toLowerCase();
  if (
    lower.startsWith("http://") ||
    lower.startsWith("https://") ||
    lower.startsWith("mailto:")
  ) {
    return trimmed;
  }
  return undefined;
}

/**
 * Sanitize a user-supplied URL before assigning to <img src> or SVG <image href>.
 * Allows http(s) and only safe raster data URLs. Rejects SVG data URLs because
 * they can carry executable script.
 */
export function safeImgSrc(url) {
  if (typeof url !== "string") return undefined;
  const trimmed = url.trim();
  if (!trimmed) return undefined;
  const lower = trimmed.toLowerCase();
  if (lower.startsWith("http://") || lower.startsWith("https://")) return trimmed;
  if (
    lower.startsWith("data:image/png;base64,") ||
    lower.startsWith("data:image/jpeg;base64,") ||
    lower.startsWith("data:image/jpg;base64,") ||
    lower.startsWith("data:image/webp;base64,") ||
    lower.startsWith("data:image/gif;base64,")
  ) {
    return trimmed;
  }
  return undefined;
}
