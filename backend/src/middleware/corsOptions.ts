import type { CorsOptions, CorsOptionsDelegate } from 'cors';
import { config } from '../config';

/**
 * EDD Section 33: "CORS policy: restricted to known frontend origins."
 *
 * config.cors.allowedOrigins is an explicit allowlist (empty by default —
 * deny all cross-origin requests, per the Foundation subsystem's
 * documented reasoning). Requests with no Origin header at all (same-
 * origin requests, curl/Postman, server-to-server calls) are not CORS
 * requests in the first place and are always allowed through — the
 * allowlist only governs requests that declare a cross-origin Origin.
 */
const corsOptionsDelegate: CorsOptionsDelegate = (req, callback) => {
  const origin = req.headers.origin;

  if (!origin || config.cors.allowedOrigins.includes(origin)) {
    const options: CorsOptions = { origin: true };
    callback(null, options);
    return;
  }

  callback(null, { origin: false });
};

export { corsOptionsDelegate };
