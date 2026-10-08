import { chromium } from "@playwright/test";
import { writeFile, mkdir, readFile } from "node:fs/promises";
const origin = process.env.BROWSER_ORIGIN || "http://localhost:3200",
  mode = process.env.BROWSER_MODE || "prelaunch",
  checks = [],
  artifacts = process.env.BROWSER_ARTIFACTS || "artifacts";
const publicPaths = [
  "/",
  "/campaigns",
  "/dashboard",
  "/admin",
  "/terms",
  "/privacy",
  "/disclosures",
  "/missing-page",
];
for (const path of publicPaths) await fetch(origin + path);
await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
  args: ["--no-sandbox"],
});
try {
  for (const [width, height] of [
    [375, 812],
    [390, 844],
    [768, 1024],
    [1024, 768],
    [1440, 900],
  ]) {
    const page = await browser.newPage({
        viewport: { width, height },
        timezoneId: "Europe/London",
      }),
      errors = [];
    page.on("pageerror", (e) =>
      errors.push(
        JSON.stringify({ message: e.message, stack: e.stack, url: page.url() }),
      ),
    );
    for (const path of publicPaths) {
      const response = await page.goto(origin + path, {
        waitUntil: "networkidle",
      });
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      );
      checks.push({ width, path, status: response.status(), overflow });
      if (overflow) throw Error("Overflow: " + width + path);
      const text = await page.locator("body").innerText();
      if (mode === "demo" && !text.includes("DEMO DATA — NOT LIVE"))
        throw Error("Demo banner missing");
      if (mode !== "demo" && text.includes("DEMO DATA"))
        throw Error("Unexpected demo banner");
      if (/DATABASE_URL|SOLANA_RPC_URL|HELIUS_API_KEY/.test(text))
        throw Error("Raw configuration leaked");
      if (path === "/") {
        if (
          !text.includes("Use creator fees to") ||
          !text.includes("put your coin")
        )
          throw Error("Wrong creator positioning");
        if (
          /Every trade buys airtime|NEXT AIRTIME DROP|Trade \$AIRTIME/.test(
            text,
          )
        )
          throw Error("Legacy treasury copy");
        if ((await page.title()) !== "AIRTIME — Put Your Coin on TV")
          throw Error("Metadata mismatch");
        if (width <= 390) {
          await page.getByRole("button", { name: "Toggle navigation" }).click();
          await page
            .locator("#primary-navigation")
            .getByRole("link", { name: "How It Works" })
            .click();
          if (
            (await page
              .getByRole("button", { name: "Toggle navigation" })
              .getAttribute("aria-expanded")) !== "false"
          )
            throw Error("Mobile menu failed");
        }
        await page.screenshot({
          path: `${artifacts}/airtime-platform-${mode}-${width}.png`,
          fullPage: true,
        });
      }
    }
    await page.goto(origin, { waitUntil: "networkidle" });
    await page
      .getByRole("button", { name: "Connect Creator Wallet", exact: true })
      .first()
      .click();
    await page.getByRole("dialog").waitFor();
    if (
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      )
    )
      throw Error("Wallet dialog overflow");
    await page.keyboard.press("Escape");
    if (await page.getByRole("dialog").count())
      throw Error("Wallet Escape failed");
    if (errors.length) throw Error(errors.join("\n"));
    await page.close();
  }
  const anonymous = await browser.newPage();
  for (const path of [
    "/api/admin/operations",
    "/api/creator/state",
    "/api/worker",
  ]) {
    const r = await anonymous.request.get(origin + path);
    checks.push({ path, status: r.status() });
    if (r.status() !== 401) throw Error("Unauthorized API access: " + path);
  }
  for (const path of ["/api/public", "/api/trade"]) {
    const r = await anonymous.request.get(origin + path);
    if (r.status() !== 410) throw Error("Legacy public route active");
    checks.push({ path, status: r.status() });
  }
  const platform = await anonymous.request.get(origin + "/api/platform");
  if (!platform.ok()) throw Error("Public platform config unavailable");
  if (process.env.BROWSER_CREATOR === "true") {
    if (mode !== "demo")
      throw Error("Local authenticated fixtures require DEMO mode");
    const fixture = JSON.parse(
        await readFile("/tmp/airtime-layout-session.json", "utf8"),
      ),
      video = await readFile("tests/fixtures/technical-test-15s.mp4");
    const context = await browser.newContext({ timezoneId: "Europe/London" });
    await context.addCookies([
      {
        name: "airtime_creator",
        value: fixture.token,
        url: origin,
        httpOnly: true,
        sameSite: "Strict",
      },
    ]);
    await context.route("**/api/creator/media?**", (route) =>
      route.fulfill({ status: 200, contentType: "video/mp4", body: video }),
    );
    const paths = [
      "/dashboard",
      "/dashboard/coins",
      "/dashboard/campaigns",
      "/dashboard/campaigns/" + fixture.campaign,
      "/dashboard/create/" + fixture.campaign,
      "/dashboard/billing",
      "/dashboard/account",
    ];
    for (const path of paths)
      await fetch(origin + path, {
        headers: { cookie: "airtime_creator=" + fixture.token },
      });
    for (const [width, height] of [
      [375, 812],
      [390, 844],
      [768, 1024],
      [1024, 768],
      [1440, 900],
    ]) {
      const page = await context.newPage(),
        errors = [];
      page.on("pageerror", (e) =>
        errors.push(
          JSON.stringify({
            message: e.message,
            stack: e.stack,
            url: page.url(),
          }),
        ),
      );
      await page.setViewportSize({ width, height });
      for (const path of paths) {
        const r = await page.goto(origin + path, {
          waitUntil: "domcontentloaded",
        });
        if (!r.ok()) throw Error("Creator page failed " + path);
        if (!(await page.locator(".app-sidebar").count()))
          throw Error("Creator state failed to load " + path);
        await page.locator(".app-sidebar").waitFor();
        await page.evaluate(async () => {
          await document.fonts.ready;
          await new Promise(requestAnimationFrame);
        });
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        );
        checks.push({ width, path, status: r.status(), overflow });
        if (overflow) throw Error("Creator overflow " + width + path);
        if (
          !(await page.locator("body").innerText()).includes(
            "DEMO DATA — NOT LIVE",
          )
        )
          throw Error("Creator fixture label missing");
        if (path === "/dashboard")
          await page.screenshot({
            path: `${artifacts}/airtime-dashboard-${width}.png`,
            fullPage: true,
          });
        if (path.includes("/create/")) {
          for (const step of [
            "Coin",
            "Commercial",
            "Audience",
            "Approval",
            "Payment",
          ]) {
            await page
              .locator(".builder-steps")
              .getByRole("button", { name: step, exact: false })
              .click();
            if (
              await page.evaluate(
                () => document.documentElement.scrollWidth > innerWidth,
              )
            )
              throw Error("Builder overflow " + step + width);
          }
          await page.screenshot({
            path: `${artifacts}/airtime-builder-${width}.png`,
            fullPage: true,
          });
        }
      }
      if (errors.length) throw Error(errors.join("\n"));
      await page.close();
    }
    const r = await context.request.get(origin + "/api/creator/state");
    if (r.status() !== 200) throw Error("Authenticated creator API failed");
    const data = await r.json();
    if (data.identity.wallet !== fixture.wallet || data.campaigns.length !== 1)
      throw Error("Creator scoping failed");
    await context.close();
  }
  await writeFile(
    `${artifacts}/browser-platform-${mode}.json`,
    JSON.stringify(checks, null, 2),
  );
  console.log(
    JSON.stringify(
      {
        mode,
        checks: checks.length,
        widths: [375, 390, 768, 1024, 1440],
        overflow: false,
        creatorFixtures: process.env.BROWSER_CREATOR === "true",
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
