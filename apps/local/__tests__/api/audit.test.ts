/**
 * @jest-environment node
 */

import { NextRequest } from 'next/server';

describe('GET /api/audit', () => {
  test('returns 501 stub response (audit unavailable in local runtime)', async () => {
    const { GET } = await import('@/app/api/audit/route');
    const request = new NextRequest('http://localhost/api/audit');
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(501);
    expect(data.logs).toEqual([]);
    expect(data.warning).toContain('unavailable');
  });
});
