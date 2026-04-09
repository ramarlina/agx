// @ts-expect-error no types
import { createMocks } from 'node-mocks-http';

// Mock NextRequest/NextResponse
jest.mock('next/server', () => ({
  NextRequest: jest.fn(),
  NextResponse: {
    json: (data: any, options?: any) => ({
      json: () => Promise.resolve(data),
      ...options,
    }),
  },
}));

describe('/api/domains', () => {
  it('should list all domains', async () => {
    // Import after mocks are set up
    const { GET } = require('@/app/api/domains/route');

    const request = {
      url: 'http://localhost:3000/api/domains',
      nextUrl: {
        searchParams: new Map(),
      },
    } as any;

    const response = await GET(request);
    const data = await response.json();

    expect(data).toHaveProperty('domains');
    expect(data).toHaveProperty('total');
    expect(Array.isArray(data.domains)).toBe(true);
    expect(data.total).toBe(6); // 6 blockchain domains
  });

  it('should filter domains by type', async () => {
    const { GET } = require('@/app/api/domains/route');

    const searchParams = new Map([['type', 'L1']]);
    const request = {
      url: 'http://localhost:3000/api/domains?type=L1',
      nextUrl: { searchParams },
    } as any;

    const response = await GET(request);
    const data = await response.json();

    expect(data.domains.length).toBe(2); // Ethereum and Solana
    expect(data.domains.every((d: any) => d.type === 'L1')).toBe(true);
  });

  it('should get a specific domain', async () => {
    const { GET } = require('@/app/api/domains/[id]/route');

    const request = {} as any;
    const params = { params: { id: 'ethereum' } };

    const response = await GET(request, params);
    const data = await response.json();

    expect(data.domain.id).toBe('ethereum');
    expect(data.domain.name).toBe('Ethereum');
  });

  it('should return 404 for non-existent domain', async () => {
    const { GET } = require('@/app/api/domains/[id]/route');

    const request = {} as any;
    const params = { params: { id: 'nonexistent' } };

    const response = await GET(request, params);
    expect(response.status).toBe(404);
  });
});
