import { useEffect, useRef } from "react";
import { useGoogleSignIn } from "../hooks/useAuth";
import { GOOGLE_AUTH_CONFIG } from "../config/google-auth";

interface GoogleCredentialResponse {
  credential: string;
}

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: { client_id: string; callback: (resp: GoogleCredentialResponse) => void }) => void;
          renderButton: (parent: HTMLElement, options: Record<string, unknown>) => void;
        };
      };
    };
  }
}

let gisLoad: Promise<void> | null = null;

/** Google Identity Services is a third-party script, not an npm dependency — loaded once and cached across every mount of this button. */
function loadGoogleIdentityServices(): Promise<void> {
  if (window.google?.accounts?.id) return Promise.resolve();
  if (!gisLoad) {
    gisLoad = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.defer = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Failed to load Google Identity Services"));
      document.head.appendChild(script);
    });
  }
  return gisLoad;
}

export function GoogleSignInButton() {
  const ref = useRef<HTMLDivElement>(null);
  const signIn = useGoogleSignIn();

  useEffect(() => {
    let cancelled = false;
    loadGoogleIdentityServices()
      .then(() => {
        if (cancelled || !ref.current || !window.google) return;
        // Re-initializing on every mount (e.g. after a sign-out swaps the
        // header back to this button) logs GIS's own "initialize() called
        // multiple times" warning — harmless, since GIS explicitly keeps the
        // *last* registered callback, which is exactly what we want: it
        // binds to *this* mount's `signIn`, so isPending/isError below stay
        // truthful. Skipping re-init to silence the warning would instead
        // leave GIS calling a stale callback tied to an unmounted button.
        window.google.accounts.id.initialize({
          client_id: GOOGLE_AUTH_CONFIG.clientId,
          callback: (resp) => signIn.mutate(resp.credential),
        });
        window.google.accounts.id.renderButton(ref.current, {
          theme: "outline",
          size: "medium",
          text: "signin_with",
          shape: "rectangular",
        });
      })
      .catch((err) => console.error(err));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex items-center gap-2">
      <div ref={ref} />
      {signIn.isPending && (
        <span className="text-sm" style={{ color: "var(--of-fg-muted)" }}>
          Signing in…
        </span>
      )}
      {signIn.isError && (
        <span className="text-sm" style={{ color: "var(--of-fg-danger)" }}>
          Sign-in failed — try again.
        </span>
      )}
    </div>
  );
}
