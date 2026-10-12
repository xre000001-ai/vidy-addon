// Every platform API call rides the NETHEX ready bench (mb-lib/pool.js).
// Playback URLs are returned directly and are never sent through any proxy.
import { apiFetch } from './pool.js';

export { apiFetch };
export const apiProxyEnabled = true;   // pool-only: no direct API path exists
