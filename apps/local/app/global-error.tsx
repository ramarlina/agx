"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // This must be a client component to avoid SSR issues
  return (
    <html lang="en">
      <body style={{
        margin: 0,
        padding: 0,
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "var(--background, #f3f4f6)",
        color: "var(--foreground, #111827)",
        fontFamily: "system-ui, sans-serif",
      }}>
        <div style={{
          textAlign: "center",
          padding: "2rem",
          maxWidth: "400px",
        }}>
          <h1 style={{ fontSize: "1.5rem", fontWeight: 600, marginBottom: "1rem" }}>
            Something went wrong
          </h1>
          <p style={{ color: "var(--muted-foreground, #667085)", marginBottom: "1.5rem" }}>
            An unexpected error occurred. Please try refreshing the page.
          </p>
          <button
            onClick={() => reset()}
            style={{
              padding: "0.5rem 1rem",
              borderRadius: "0.375rem",
              border: "1px solid var(--border, rgba(15, 23, 42, 0.1))",
              background: "var(--primary, #2563EB)",
              color: "white",
              fontSize: "0.875rem",
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}