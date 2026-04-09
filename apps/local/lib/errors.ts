/**
 * Thrown when a unique constraint is violated (e.g. duplicate slug, duplicate key).
 * Mapped from PG error code 23505 and SQLite SQLITE_CONSTRAINT_UNIQUE.
 */
export class ConflictError extends Error {
  readonly constraint?: string;
  readonly detail?: string;

  constructor(message: string, opts?: { constraint?: string; detail?: string }) {
    super(message);
    this.name = "ConflictError";
    this.constraint = opts?.constraint;
    this.detail = opts?.detail;
  }
}

/**
 * Thrown when the database is temporarily busy/locked and the operation
 * can be retried. Mapped from PG serialization failures and SQLite SQLITE_BUSY.
 */
export class RetryableError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = "RetryableError";
    this.code = code;
  }
}

/**
 * Thrown when an optimistic-concurrency update fails because the record
 * was modified by another writer since it was last read.
 */
export class ConcurrentModificationError extends Error {
  readonly expectedVersion: number;
  readonly actualVersion?: number;
  readonly entityId: string;
  readonly entityType: string;

  constructor(
    entityType: string,
    entityId: string,
    expectedVersion: number,
    actualVersion?: number,
  ) {
    const msg = actualVersion !== undefined
      ? `Concurrent modification on ${entityType} ${entityId}: expected version ${expectedVersion}, found ${actualVersion}`
      : `Concurrent modification on ${entityType} ${entityId}: expected version ${expectedVersion}, row not updated`;
    super(msg);
    this.name = "ConcurrentModificationError";
    this.entityType = entityType;
    this.entityId = entityId;
    this.expectedVersion = expectedVersion;
    this.actualVersion = actualVersion;
  }
}
