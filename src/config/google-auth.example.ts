// Google OAuth Configuration Template
// Copy this file to google-auth.ts and fill in your client ID.
//
// NOTE: this file is bundled into the browser. The OAuth *client ID* is public
// by design and safe here. Never put a client secret in this file — anything
// in this config ships to every visitor. The Worker verifies sign-ins
// server-side using GOOGLE_CLIENT_ID from its own environment
// (see .dev.vars.example).
//
// One Google Cloud OAuth client covers the whole suite (RitualBuilder +
// TeamRitualAudit) — reuse the same client id here as there, and add this
// app's origin to the client's authorized JavaScript origins in the Google
// Cloud Console (see suite-auth-strategy memory).

export const GOOGLE_AUTH_CONFIG = {
  clientId: "YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com",
};

// Instructions:
// 1. Copy this file to google-auth.ts
// 2. Replace YOUR_GOOGLE_CLIENT_ID with the suite's client id
// 3. Set the same client id for the Worker (see .dev.vars.example / wrangler.jsonc)
// 4. google-auth.ts is gitignored and won't be committed to version control
