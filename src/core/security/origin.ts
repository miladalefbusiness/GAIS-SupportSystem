export const MUTATING_HTTP_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function extractHostname(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const parsed = trimmed.includes('://')
      ? new URL(trimmed)
      : new URL(`https://${trimmed}`);
    return parsed.host.toLowerCase();
  } catch {
    return null;
  }
}

export function isAllowedMutationOrigin(params: {
  method: string;
  originHeader: string | null;
  hostHeader: string | null;
  forwardedHostHeader: string | null;
  appUrl?: string | null;
}): { allowed: boolean; reason?: string } {
  const method = params.method.toUpperCase();
  if (!MUTATING_HTTP_METHODS.has(method)) {
    return { allowed: true };
  }

  // Non-browser / server-to-server requests without Origin are governed by session cookies & bearer auth
  if (!params.originHeader) {
    return { allowed: true };
  }

  const originHost = extractHostname(params.originHeader);
  if (!originHost) {
    return { allowed: false, reason: 'INVALID_ORIGIN_HEADER' };
  }

  const allowedHosts = new Set<string>();
  const h1 = extractHostname(params.hostHeader);
  const h2 = extractHostname(params.forwardedHostHeader?.split(',')[0]);
  const h3 = extractHostname(params.appUrl);

  if (h1) allowedHosts.add(h1);
  if (h2) allowedHosts.add(h2);
  if (h3) allowedHosts.add(h3);

  if (allowedHosts.size === 0) {
    return { allowed: false, reason: 'MISSING_EXPECTED_HOST' };
  }

  if (allowedHosts.has(originHost)) {
    return { allowed: true };
  }

  return { allowed: false, reason: 'CSRF_ORIGIN_MISMATCH' };
}
