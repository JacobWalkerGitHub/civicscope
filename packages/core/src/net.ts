/**
 * The client IP from X-Forwarded-For, counted from the right. Each proxy appends the
 * address it received the request from, so the leftmost entries are whatever the client
 * chose to send and can't be trusted (using them would let anyone dodge the sign-in and
 * correction-form rate limits). With TRUSTED_PROXY_COUNT proxies in front of the app
 * (1 for a load balancer alone, 2 for CloudFront then a load balancer), the client is
 * that many entries from the end.
 */
export function clientIpFromForwarded(
  forwarded: string | null | undefined,
  trustedProxies: number,
): string | null {
  if (!forwarded) return null;
  const hops = forwarded
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!hops.length) return null;
  // Fewer entries than proxies: the request skipped a proxy, so take the leftmost.
  const ip = hops[Math.max(0, hops.length - trustedProxies)]!;
  return ip.slice(0, 45);
}
