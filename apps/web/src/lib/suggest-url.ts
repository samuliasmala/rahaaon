/** Loose pre-submit check matching the prototype: "starts with http(s):// and has a dot". */
export function isLikelyUrl(value: string): boolean {
  return /^https?:\/\/.+\..+/.test(value.trim());
}
