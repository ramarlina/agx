/**
 * Minimal storage helpers exported for TypeScript consumers.
 */

import type { ThreadAdapter, ThreadPayload } from './thread-adapter';
import type { LocalThreadAdapterOptions } from './local-thread-adapter';
import { LocalThreadAdapter } from './local-thread-adapter';

export type { ThreadAdapter, ThreadPayload, LocalThreadAdapterOptions };
export { LocalThreadAdapter };

// ============================================================
// agent_memory types
// ============================================================

export type MemoryType = 'outcome' | 'decision' | 'pattern' | 'gotcha';

export interface MemoryRecord {
    id: string;
    agent_id: string;
    task_id: string;
    memory_type: MemoryType;
    content: string;
    content_hash: string;
    created_at: number;
}
