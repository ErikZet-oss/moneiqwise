import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Počet kusov na obrazovke: celé čísla bez „.0000“, frakčné bez zbytočných núl. */
export function formatShareQuantity(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const v = value;
  if (Math.abs(v - Math.round(v)) < 1e-9) {
    return String(Math.round(v));
  }
  const s = v.toFixed(8).replace(/\.?0+$/, "");
  return s === "" ? "0" : s;
}
