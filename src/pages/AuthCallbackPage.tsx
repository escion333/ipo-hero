import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { getCommunityClient } from "../lib/community/client";
import { useCommunityUser } from "../lib/community/auth";

export function AuthCallbackPage() {
  const navigate = useNavigate();
  const { enabled, refresh } = useCommunityUser();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    async function complete() {
      if (!enabled) return;
      try {
        await getCommunityClient().completeOAuthCallback();
        await refresh();
        if (active) navigate("/forums", { replace: true });
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : "Could not complete sign-in.");
      }
    }
    void complete();
    return () => {
      active = false;
    };
  }, [enabled, navigate, refresh]);

  return (
    <main className="community-shell">
      <section className="community-panel community-centered">
        <p className="community-eyebrow">IPO Hero Community</p>
        <h1>Completing sign-in</h1>
        {!enabled ? (
          <p className="community-muted">Community auth is not configured for this environment.</p>
        ) : error ? (
          <>
            <p className="community-error">{error}</p>
            <Link className="community-link" to="/forums">Back to forums</Link>
          </>
        ) : (
          <p className="community-muted">Hang tight while the session is confirmed.</p>
        )}
      </section>
    </main>
  );
}
