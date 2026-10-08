import Link from "next/link";
export default function NotFound() {
  return (
    <main className="error-page">
      <h1>This transmission is missing.</h1>
      <p>The campaign or page could not be found.</p>
      <Link className="button" href="/">
        Back to AIRTIME
      </Link>
    </main>
  );
}
