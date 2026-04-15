import { NextResponse } from 'next/server';
import { getAgents } from '@/lib/db';
import { LOCAL_USER } from '@/lib/auth-mode';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/prompt-jobs/agents — list available agents for the picker */
export async function GET() {
  try {
    const agents = await getAgents(LOCAL_USER.id);
    const items = agents.map((a) => ({
      id: a.id,
      name: a.name,
      provider: a.provider || 'claude',
      model: a.model || null,
      color: a.color || '#6B7280',
      role: a.role || null,
    }));
    return NextResponse.json({ agents: items });
  } catch (error) {
    console.error('Failed to list agents:', error);
    return NextResponse.json({ error: 'Failed to list agents' }, { status: 500 });
  }
}
