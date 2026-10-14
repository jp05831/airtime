// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ContractAddress } from "@/components/contract-address";
import { tokenMint } from "@/lib/token-mint";

const mint = "So11111111111111111111111111111111111111112";
let container: HTMLDivElement;
let root: Root;
let writeText: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
function render(value?: string) {
  act(() =>
    root.render(createElement(ContractAddress, { address: tokenMint(value) })),
  );
}
describe("AIRTIME contract address", () => {
  it("accepts the announced AIRTIME launch mint", () => {
    const launchMint = "EfokqPwaen38iWAVok7TEA3dVzZ5VaNtWGwTgomVpump";
    expect(tokenMint(launchMint)).toBe(launchMint);
  });
  it.each([undefined, "", "   "])(
    "shows coming at launch for blank configuration %s",
    (value) => {
      render(value);
      expect(container.textContent).toContain("Contract Address");
      expect(container.textContent).toContain("Coming at launch");
      expect(container.querySelector("button")!.disabled).toBe(true);
      expect(container.querySelectorAll("a")).toHaveLength(0);
      act(() => container.querySelector("button")!.click());
      expect(writeText).not.toHaveBeenCalled();
    },
  );
  it.each([
    "not-a-mint",
    "0".repeat(44),
    "1".repeat(44),
    `${mint} `,
    `https://pump.fun/coin/${mint}`,
  ])("fails closed for invalid configuration %s", (value) => {
    expect(tokenMint(value)).toBeNull();
    render(value);
    expect(container.textContent).toContain("Coming at launch");
    expect(container.querySelector("button")!.disabled).toBe(true);
    expect(container.querySelectorAll("a")).toHaveLength(0);
  });
  it("renders the full valid address, its mobile form, and mint-specific links", () => {
    expect(tokenMint(mint)).toBe(mint);
    render(mint);
    expect(container.querySelector(".contract-address-full")!.textContent).toBe(
      mint,
    );
    expect(
      container.querySelector(".contract-address-mobile")!.textContent,
    ).toBe(`${mint.slice(0, 8)}…${mint.slice(-8)}`);
    expect(
      container
        .querySelector(".contract-address-value")!
        .getAttribute("aria-label"),
    ).toBe(mint);
    expect(container.querySelector("button")!.disabled).toBe(false);
    const links = [...container.querySelectorAll("a")];
    expect(links.map((link) => link.href)).toEqual([
      `https://pump.fun/coin/${mint}`,
      `https://axiom.trade/t/${mint}`,
    ]);
    expect(links.map((link) => link.textContent)).toEqual([
      "View on Pump.fun ↗",
      "Trade on Axiom ↗",
    ]);
  });
  it("copies the exact full address and temporarily shows Copied", async () => {
    vi.useFakeTimers();
    render(mint);
    const button = container.querySelector("button")!;
    await act(async () => button.click());
    expect(writeText).toHaveBeenCalledExactlyOnceWith(mint);
    expect(button.textContent).toBe("Copied");
    act(() => vi.advanceTimersByTime(2000));
    expect(button.textContent).toBe("Copy CA");
  });
  it("reports clipboard failure without claiming success", async () => {
    writeText.mockRejectedValue(new Error("Permission denied"));
    render(mint);
    await act(async () => container.querySelector("button")!.click());
    expect(container.querySelector("button")!.textContent).toBe("Copy CA");
    expect(container.querySelector('[role="status"]')!.textContent).toContain(
      "Unable to copy",
    );
  });
});
