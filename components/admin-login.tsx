"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
export default function AdminLogin() {
  const router = useRouter(),
    [step, setStep] = useState("login"),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [code, setCode] = useState(""),
    [secret, setSecret] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function request(path: string, payload: unknown) {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/auth/" + path, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }),
        data = await r.json();
      if (!r.ok) throw Error(data.error);
      if (path === "login") {
        setStep(data.step);
        setPassword("");
      }
      if (path === "enroll") {
        setSecret(data.secret);
        setStep("verify");
      }
      if (path === "verify") {
        setSecret("");
        router.refresh();
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel admin-login">
      <span className="eyebrow">SECURE OPERATOR ACCESS</span>
      <h2>Sign in to the broadcast desk.</h2>
      <p>
        Only the allowlisted administrator can continue. An authenticator code
        is required before any campaign or treasury control is available.
      </p>
      {step === "login" ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            request("login", { email, password });
          }}
        >
          <label>
            Email
            <input
              type="email"
              required
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label>
            Password
            <input
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <button className="button" disabled={busy}>
            {busy ? "Signing in…" : "Continue to two-factor verification"}
          </button>
        </form>
      ) : step === "enroll" ? (
        <div>
          <p>Set up a TOTP authenticator before accessing the admin panel.</p>
          <button
            className="button"
            disabled={busy}
            onClick={() => request("enroll", {})}
          >
            Set up authenticator
          </button>
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            request("verify", { code });
          }}
        >
          {secret && (
            <div className="notice">
              <strong>New authenticator enrollment</strong>
              <p>
                Enter this setup key in your authenticator app, then submit its
                six-digit code. Keep the key private.
              </p>
              <code className="wallet-address">{secret}</code>
            </div>
          )}
          <label>
            Authenticator code
            <input
              required
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </label>
          <button className="button" disabled={busy}>
            {busy ? "Verifying…" : "Verify & open admin"}
          </button>
        </form>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <details className="admin-setup-note">
        <summary>Administrator setup requirements</summary>
        <p>
          Create the ADMIN_EMAIL user in Supabase Auth, disable public signup,
          and configure SUPABASE_URL, SUPABASE_ANON_KEY, DATABASE_URL,
          APP_ORIGIN, AUTH_SECRET and TOTP_ENCRYPTION_KEY. See docs/ADMIN.md.
        </p>
      </details>
    </section>
  );
}
