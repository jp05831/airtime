import { rootCertificates } from "node:tls";
import { describe, expect, it } from "vitest";
import {
  databaseConnectionOptions,
  type DatabaseEnvironment,
} from "@/lib/server/database-config";

const ca = Buffer.from(rootCertificates[0], "utf8").toString("base64");
const productionEnv = (overrides: Partial<DatabaseEnvironment> = {}) => ({
  NODE_ENV: "production",
  DATABASE_URL:
    "postgresql://postgres.projectref:password@aws-0-us-east-1.pooler.supabase.com:5432/postgres?sslmode=verify-full&sslrootcert=%2Ftmp%2Fignored.crt",
  DATABASE_CA_CERT_BASE64: ca,
  ...overrides,
});

describe("production PostgreSQL TLS configuration", () => {
  it("uses explicit verified TLS with the decoded CA and strips URL SSL parameters", () => {
    const options = databaseConnectionOptions(productionEnv());
    const url = new URL(options.connectionString);

    expect(options.ssl).toEqual({
      rejectUnauthorized: true,
      ca: rootCertificates[0],
    });
    expect([...url.searchParams.keys()].some((key) => key.toLowerCase().startsWith("ssl"))).toBe(false);
    expect(options.connectionString).not.toContain("ignored.crt");
  });

  it("requires the Supabase session pooler on port 5432", () => {
    for (const DATABASE_URL of [
      "postgresql://postgres:password@db.projectref.supabase.co:5432/postgres?sslmode=verify-full",
      "postgresql://postgres.projectref:password@aws-0-us-east-1.pooler.supabase.com:6543/postgres?sslmode=verify-full",
    ])
      expect(() => databaseConnectionOptions(productionEnv({ DATABASE_URL }))).toThrow(
        "Supabase session pooler on port 5432",
      );
  });

  it("requires verify-full and a valid base64 CA certificate without echoing secrets", () => {
    expect(() =>
      databaseConnectionOptions(
        productionEnv({
          DATABASE_URL:
            "postgresql://user:secret@aws-0-us-east-1.pooler.supabase.com:5432/postgres?sslmode=require",
        }),
      ),
    ).toThrow("sslmode=verify-full");
    expect(() =>
      databaseConnectionOptions(productionEnv({ DATABASE_CA_CERT_BASE64: "bm90IGEgcGVt" })),
    ).toThrow("X.509 CA certificate");
    try {
      databaseConnectionOptions(productionEnv({ DATABASE_CA_CERT_BASE64: "bm90IGEgcGVt" }));
    } catch (error) {
      expect((error as Error).message).not.toContain("bm90IGEgcGVt");
      expect((error as Error).message).not.toContain("secret");
    }
  });

  it("allows local development without a CA while retaining the original URL", () => {
    const connectionString = "postgresql://localhost:5432/airtime";
    expect(
      databaseConnectionOptions({ DATABASE_URL: connectionString, NODE_ENV: "development" }),
    ).toEqual({ connectionString });
  });
});
