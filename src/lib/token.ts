export function categoryHex(value: string): string {
  return value.replace(/^0x/, "").toLowerCase();
}

export function reversedHex(value: string): string {
  let out = "";
  for (let index = value.length - 2; index >= 0; index -= 2) out += value.slice(index, index + 2);
  return out;
}

/** True when both ids name the same category, including the reversed byte order Electrum sometimes returns. */
export function sameCategory(wanted: string, seen: string | undefined): boolean {
  if (seen === undefined || seen === "") return false;
  const left = categoryHex(wanted);
  const right = categoryHex(seen);
  return left === right || (left.length === 64 && right.length === 64 && reversedHex(right) === left);
}

/** Prefer the id the market list uses, so a reversed Electrum id still labels the token the wallet shows. */
export function displayCategory(raw: string | undefined, known: string[]): string | undefined {
  if (raw === undefined || raw === "") return undefined;
  const key = categoryHex(raw);
  if (known.some((item) => categoryHex(item) === key)) return key;
  if (key.length !== 64) return key;
  const flipped = reversedHex(key);
  if (known.some((item) => categoryHex(item) === flipped)) return flipped;
  return key;
}
