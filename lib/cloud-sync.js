/**
 * Cloud Sync - Sync local checkpoints to agx cloud API.
 *
 * Local-first with cloud sync:
 * - Checkpoints are always saved locally first
 * - Cloud sync happens asynchronously (best-effort)
 * - Failures don't block local operations
 *
 * Sync strategy:
 * - On checkpoint create: queue for cloud sync
 * - Background worker processes queue
 * - Retry with exponential backoff
 */

const fs = require('fs');
const path = require('path');

const SYNC_QUEUE_FILE = 'sync-queue.json';
const MAX_RETRY_ATTEMPTS = 3;
const RETRY_DELAY_MS = 1000;

/**
 * Load cloud config from environment or config file.
 * @returns {{ apiUrl: string, token: string, userId: string } | null}
 */
function loadCloudConfig() {
  // Try environment first
  if (process.env.AGX_CLOUD_URL) {
    return {
      apiUrl: process.env.AGX_CLOUD_URL,
      token: process.env.AGX_CLOUD_TOKEN || '',
      userId: process.env.AGX_CLOUD_USER_ID || '',
    };
  }
  
  // Try config file
  try {
    const configPath = path.join(process.env.HOME || '', '.agx', 'cloud-config.json');
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }
  } catch {
    // Ignore
  }
  
  return null;
}

/**
 * Sync a checkpoint to the cloud.
 * @param {object} options
 * @param {string} options.taskId - Cloud task ID
 * @param {object} options.checkpoint - Checkpoint data
 * @param {function} options.onLog - Logging callback
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
async function syncCheckpointToCloud({ taskId, checkpoint, onLog = () => {} }) {
  const config = loadCloudConfig();
  if (!config?.apiUrl) {
    return { success: false, error: 'No cloud config' };
  }
  
  if (!taskId) {
    return { success: false, error: 'No task ID' };
  }
  
  try {
    const url = `${config.apiUrl}/api/tasks/${taskId}/checkpoints`;
    
    // Prepare checkpoint for cloud (remove large fields)
    const cloudCheckpoint = {
      id: checkpoint.id,
      label: checkpoint.label,
      createdAt: checkpoint.createdAt,
      iteration: checkpoint.iteration,
      objective: checkpoint.objective,
      // Include plan summary, not full plan
      planStepCount: checkpoint.plan?.steps?.length || 0,
      currentStep: checkpoint.plan?.currentStep,
      // Include criteria summary
      criteriaCount: checkpoint.criteria?.length || 0,
      criteriaPassed: checkpoint.criteria?.filter(c => c.passed)?.length || 0,
      // Git info (no patch content)
      gitSha: checkpoint.git?.sha,
      gitBranch: checkpoint.git?.branch,
      gitDirty: checkpoint.git?.dirty,
      // Blocked info
      blockedAt: checkpoint.blockedAt,
      blockedReason: checkpoint.reason,
    };
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(config.token ? { 'Authorization': `Bearer ${config.token}` } : {}),
        ...(config.userId ? { 'x-user-id': config.userId } : {}),
      },
      body: JSON.stringify(cloudCheckpoint),
    });
    
    if (!response.ok) {
      const error = `HTTP ${response.status}`;
      onLog(`[cloud-sync] Failed to sync checkpoint: ${error}`);
      return { success: false, error };
    }
    
    onLog(`[cloud-sync] Checkpoint ${checkpoint.id} synced`);
    return { success: true };
  } catch (err) {
    const error = err?.message || String(err);
    onLog(`[cloud-sync] Sync error: ${error}`);
    return { success: false, error };
  }
}

/**
 * Queue a checkpoint for cloud sync.
 * @param {string} taskRoot - Local task directory
 * @param {object} checkpoint - Checkpoint data
 * @param {string} cloudTaskId - Cloud task ID
 */
async function queueForSync(taskRoot, checkpoint, cloudTaskId) {
  if (!taskRoot || !checkpoint || !cloudTaskId) return;
  
  try {
    const queuePath = path.join(taskRoot, SYNC_QUEUE_FILE);
    let queue = [];
    
    if (fs.existsSync(queuePath)) {
      try {
        queue = JSON.parse(fs.readFileSync(queuePath, 'utf8'));
      } catch {
        queue = [];
      }
    }
    
    queue.push({
      checkpointId: checkpoint.id,
      cloudTaskId,
      checkpoint,
      queuedAt: new Date().toISOString(),
      attempts: 0,
    });
    
    fs.writeFileSync(queuePath, JSON.stringify(queue, null, 2));
  } catch {
    // Ignore queue errors
  }
}

/**
 * Process the sync queue for a task.
 * @param {string} taskRoot - Local task directory
 * @param {function} onLog - Logging callback
 * @returns {Promise<{ synced: number, failed: number }>}
 */
async function processSyncQueue(taskRoot, onLog = () => {}) {
  const queuePath = path.join(taskRoot, SYNC_QUEUE_FILE);
  if (!fs.existsSync(queuePath)) {
    return { synced: 0, failed: 0 };
  }
  
  let queue;
  try {
    queue = JSON.parse(fs.readFileSync(queuePath, 'utf8'));
  } catch {
    return { synced: 0, failed: 0 };
  }
  
  if (!Array.isArray(queue) || queue.length === 0) {
    return { synced: 0, failed: 0 };
  }
  
  let synced = 0;
  let failed = 0;
  const remaining = [];
  
  for (const item of queue) {
    const result = await syncCheckpointToCloud({
      taskId: item.cloudTaskId,
      checkpoint: item.checkpoint,
      onLog,
    });
    
    if (result.success) {
      synced++;
    } else {
      item.attempts++;
      item.lastError = result.error;
      item.lastAttempt = new Date().toISOString();
      
      if (item.attempts < MAX_RETRY_ATTEMPTS) {
        remaining.push(item);
      } else {
        failed++;
        onLog(`[cloud-sync] Checkpoint ${item.checkpointId} failed after ${MAX_RETRY_ATTEMPTS} attempts`);
      }
    }
  }
  
  // Update queue with remaining items
  if (remaining.length > 0) {
    fs.writeFileSync(queuePath, JSON.stringify(remaining, null, 2));
  } else {
    try {
      fs.unlinkSync(queuePath);
    } catch {
      // Ignore
    }
  }
  
  return { synced, failed };
}

/**
 * Create a cloud syncer that automatically syncs checkpoints.
 * @param {object} options
 * @param {string} options.taskRoot - Local task directory
 * @param {string} options.cloudTaskId - Cloud task ID
 * @param {function} options.onLog - Logging callback
 * @returns {{ sync: function, processQueue: function }}
 */
function createCloudSyncer(options = {}) {
  const { taskRoot, cloudTaskId, onLog = () => {} } = options;
  
  return {
    /**
     * Sync a checkpoint immediately (best-effort).
     */
    async sync(checkpoint) {
      if (!cloudTaskId) {
        // Queue for later if no cloud task ID yet
        await queueForSync(taskRoot, checkpoint, cloudTaskId);
        return { success: false, queued: true };
      }
      
      const result = await syncCheckpointToCloud({
        taskId: cloudTaskId,
        checkpoint,
        onLog,
      });
      
      if (!result.success) {
        // Queue for retry
        await queueForSync(taskRoot, checkpoint, cloudTaskId);
      }
      
      return result;
    },
    
    /**
     * Process queued checkpoints.
     */
    async processQueue() {
      return processSyncQueue(taskRoot, onLog);
    },
  };
}

module.exports = {
  loadCloudConfig,
  syncCheckpointToCloud,
  queueForSync,
  processSyncQueue,
  createCloudSyncer,
};
