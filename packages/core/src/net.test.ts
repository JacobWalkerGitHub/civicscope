import { describe, expect, it } from 'vitest';
import { clientIpFromForwarded } from './net';

describe('clientIpFromForwarded', () => {
  it('takes the address the trusted proxy saw, not what the client sent', () => {
    // A client spoofs "1.1.1.1"; the load balancer appends the real address.
    expect(clientIpFromForwarded('1.1.1.1, 203.0.113.9', 1)).toBe('203.0.113.9');
    // CloudFront appends the viewer, then the load balancer appends CloudFront.
    expect(clientIpFromForwarded('1.1.1.1, 203.0.113.9, 130.176.0.5', 2)).toBe('203.0.113.9');
  });

  it('handles a single entry, blanks and a missing header', () => {
    expect(clientIpFromForwarded('203.0.113.9', 2)).toBe('203.0.113.9');
    expect(clientIpFromForwarded(' , ', 1)).toBeNull();
    expect(clientIpFromForwarded(null, 1)).toBeNull();
  });
});
