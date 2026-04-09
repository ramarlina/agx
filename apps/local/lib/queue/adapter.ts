
export interface Job<T = any> {
  id: string;
  name: string;
  data: T;
}

export interface QueueOptions {
  priority?: number;
  startAfter?: number | Date; // Delay
  retryLimit?: number;
}

export interface WorkerOptions {
  batchSize?: number;
  pollInterval?: number;
}

export interface QueueAdapter {
  /**
   * Initialize the queue connection/storage
   */
  start(): Promise<void>;

  /**
   * Stop the queue and close connections
   */
  stop(): Promise<void>;

  /**
   * Send a job to the queue
   */
  send<T>(queue: string, data: T, options?: QueueOptions): Promise<string>;

  /**
   * Register a worker for a queue
   */
  work<T>(
    queue: string,
    handler: (jobs: Job<T>[]) => Promise<void>,
    options?: WorkerOptions
  ): Promise<void>;
}
