export const WSOL = "So11111111111111111111111111111111111111112";
export const ZERO = "11111111111111111111111111111111";
export function allocation(fee: bigint, bps: number) {
  if (fee < 0n || !Number.isInteger(bps) || bps < 0 || bps > 10000)
    throw Error("Invalid allocation");
  return (fee * BigInt(bps)) / 10000n;
}
export function availableFunds(
  allocated: bigint,
  seed: bigint,
  spent: bigint,
  committed: bigint,
  balance: bigint,
) {
  const booked = allocated + seed - spent - committed;
  const safe = booked > 0n ? booked : 0n;
  const liquid = balance > committed ? balance - committed : 0n;
  return safe < liquid ? safe : liquid;
}
export function usdCents(lamports: bigint, priceMicros: bigint) {
  return (lamports * priceMicros) / 10000000000000n;
}
export function percentBps(current: bigint, target: bigint) {
  if (target <= 0n || current <= 0n) return 0;
  const value = (current * 10000n) / target;
  return Number(value > 10000n ? 10000n : value);
}
export function sol(value: string | bigint) {
  const v = BigInt(value),
    a = v < 0n ? -v : v;
  return `${v < 0n ? "-" : ""}${a / 1000000000n}.${(a % 1000000000n).toString().padStart(9, "0").replace(/0+$/, "") || "0"}`;
}
export function dollars(cents: string | bigint | null) {
  if (cents === null) return "USD unavailable";
  const v = BigInt(cents);
  return (
    "$" +
    (v / 100n).toLocaleString("en-US") +
    "." +
    (v % 100n).toString().padStart(2, "0")
  );
}
export function decimalMicros(value: string) {
  if (!/^\d+(\.\d{1,12})?$/.test(value)) throw Error("Invalid price");
  const [whole, fraction = ""] = value.split(".");
  const result =
    BigInt(whole) * 1000000n + BigInt(fraction.padEnd(6, "0").slice(0, 6));
  if (result <= 0n || result > 1000000000000n) throw Error("Invalid price");
  return result;
}
