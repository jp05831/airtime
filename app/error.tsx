"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="page-content">
      <div className="panel error-page">
        <h1>Records are temporarily unavailable.</h1>
        <p>
          Your funds are not managed through this website. Please try loading
          the records again.
        </p>
        <button className="button" onClick={reset}>
          Try again
        </button>
      </div>
    </main>
  );
}
