/** Preserve numeric JSON lexemes, including billing and reporting values, before JSON parsing. */
export function exactJSON(text: string): any {
  let output = "",
    quoted = false,
    escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      output += ch;
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') quoted = false;
      continue;
    }
    if (ch === '"') {
      quoted = true;
      output += ch;
      continue;
    }
    if (ch === "-" || /\d/.test(ch)) {
      const m = text
        .slice(i)
        .match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/);
      if (!m) throw Error("Invalid numeric JSON");
      output += JSON.stringify(m[0]);
      i += m[0].length - 1;
    } else output += ch;
  }
  return JSON.parse(output);
}
export function decimalUnits(value: unknown, decimals: number): bigint {
  const m = String(value).match(/^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/);
  if (!m) throw Error("Invalid provider amount");
  const exponent = Number(m[4] || 0);
  if (Math.abs(exponent) > 12) throw Error("Amount exponent out of range");
  const raw = BigInt(m[2] + (m[3] || "")),
    power = decimals + exponent - (m[3] || "").length;
  if (power < 0 && raw % 10n ** BigInt(-power) !== 0n)
    throw Error("Provider amount has unsupported precision");
  const scaled =
    power >= 0 ? raw * 10n ** BigInt(power) : raw / 10n ** BigInt(-power);
  return m[1] ? -scaled : scaled;
}
export function fixedInvoiceAmounts(priceMicros: bigint) {
  if (priceMicros <= 0n) throw Error("Invalid SOL price");
  const media = 5000n,
    fee = 1000n,
    total = 6000n,
    lamports = (total * 10000000000000n + priceMicros - 1n) / priceMicros;
  if (lamports > BigInt(Number.MAX_SAFE_INTEGER))
    throw Error("Invoice too large");
  return { media, fee, total, lamports };
}
