export async function register() {
  if (
    process.env.NEXT_RUNTIME === "nodejs" &&
    process.env.NODE_ENV === "production" &&
    process.env.NEXT_PHASE !== "phase-production-build"
  ) {
    try {
      const { validateProduction } = await import("./lib/server/config");
      validateProduction();
    } catch (e) {
      const { redact } = await import("./lib/server/http");
      console.error(
        JSON.stringify({ event: "invalid_configuration", message: redact(e) }),
      );
      process.exit(1);
    }
  }
}
