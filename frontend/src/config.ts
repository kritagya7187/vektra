/**
 * The one place import.meta.env is read. Vite only exposes VITE_-
 * prefixed variables to client code (.env.example's own note) — nothing
 * here can ever be a real backend secret by construction.
 */
function requireEnv(name: string, value: string | undefined): string {
  if (!value || value.length === 0) {
    throw new Error(
      `Missing required environment variable ${name}. Copy .env.example to .env and fill it in.`,
    );
  }
  return value;
}

export const config = {
  apiBaseUrl: requireEnv('VITE_API_BASE_URL', import.meta.env.VITE_API_BASE_URL),
  cesiumIonToken: requireEnv('VITE_CESIUM_ION_TOKEN', import.meta.env.VITE_CESIUM_ION_TOKEN),
} as const;
