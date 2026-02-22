/**
 * Minimal storage helpers exported for TypeScript consumers.
 */

import type { ThreadAdapter, ThreadPayload } from './thread-adapter';
import type { LocalThreadAdapterOptions } from './local-thread-adapter';
import { LocalThreadAdapter } from './local-thread-adapter';

export type { ThreadAdapter, ThreadPayload, LocalThreadAdapterOptions };
export { LocalThreadAdapter };
