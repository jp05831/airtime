import { X509Certificate } from "node:crypto";

const sslConnectionParameters = new Set([
  "sslmode",
  "sslrootcert",
  "sslcert",
  "sslkey",
  "sslpassword",
  "sslcrl",
  "sslcrldir",
  "sslnegotiation",
  "uselibpqcompat",
]);

function parseDatabaseUrl(value: string) {
  try {
    return new URL(value);
  } catch {
    throw Error("DATABASE_URL must be a valid PostgreSQL connection string");
  }
}

function decodeCaCertificate(value: string) {
  const encoded = value.replace(/\s/g, "");
  if (!encoded || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded))
    throw Error("DATABASE_CA_CERT_BASE64 must contain a valid base64 CA certificate");

  const certificate = Buffer.from(encoded, "base64").toString("utf8");
  try {
    if (!new X509Certificate(certificate).ca) throw Error();
  } catch {
    throw Error("DATABASE_CA_CERT_BASE64 must contain a valid X.509 CA certificate");
  }
  return certificate;
}

export type DatabaseConnectionOptions = {
  connectionString: string;
  ssl?: { rejectUnauthorized: true; ca: string };
};
export type DatabaseEnvironment = {
  DATABASE_URL?: string;
  DATABASE_CA_CERT_BASE64?: string;
  NODE_ENV?: string;
};

/** Validates production's Supabase session-pooler configuration and creates pg options. */
export function databaseConnectionOptions(
  env: DatabaseEnvironment = process.env,
  production = env.NODE_ENV === "production",
): DatabaseConnectionOptions {
  const rawUrl = env.DATABASE_URL?.trim();
  if (!rawUrl) throw Error("DATABASE_URL is required");

  const url = parseDatabaseUrl(rawUrl);
  if (!["postgres:", "postgresql:"].includes(url.protocol))
    throw Error("DATABASE_URL must use PostgreSQL");

  const sslModes = url.searchParams.getAll("sslmode");
  if (production) {
    if (
      !url.hostname.endsWith(".pooler.supabase.com") ||
      url.port !== "5432"
    )
      throw Error("Production DATABASE_URL must use the Supabase session pooler on port 5432");
    if (sslModes.length !== 1 || sslModes[0] !== "verify-full")
      throw Error("Production PostgreSQL requires sslmode=verify-full");
    if (!env.DATABASE_CA_CERT_BASE64?.trim())
      throw Error("DATABASE_CA_CERT_BASE64 is required in production");
  }

  const caValue = env.DATABASE_CA_CERT_BASE64?.trim();
  if (!caValue) return { connectionString: rawUrl };

  const ca = decodeCaCertificate(caValue);
  // node-postgres replaces its explicit SSL object if SSL query parameters are
  // present in the connection string. Keep policy validation above, then strip
  // all SSL-related parameters and supply the verified CA explicitly.
  for (const key of [...url.searchParams.keys()])
    if (sslConnectionParameters.has(key.toLowerCase()))
      url.searchParams.delete(key);

  return {
    connectionString: url.toString(),
    ssl: { rejectUnauthorized: true, ca },
  };
}
