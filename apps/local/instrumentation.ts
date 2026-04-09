const SCHEDULE_POLL_INTERVAL_MS = 15_000;
const PROMPT_JOB_POLL_INTERVAL_MS = 15_000;

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { getConfiguredLocalServerPort } = await import("./lib/app-config");
    const { ensureScheduledTaskSkillInstalled } = await import("./lib/scheduled-task-skill");
    await import("./lib/check-node-version");
    const { getQueue, QUEUE_NAMES } = await import('@/lib/queue/boss');
    const { taskProcessor } = await import('@/lib/orchestrator/processor');
    const { chatProcessor } = await import('@/lib/orchestrator/chat-processor');

    ensureScheduledTaskSkillInstalled();

    const queue = await getQueue();
    await queue.work(QUEUE_NAMES.TASK_PROCESS, taskProcessor, { batchSize: 5 });
    await queue.work(QUEUE_NAMES.CHAT_RUN_PROCESS, chatProcessor, { batchSize: 2 });
    console.log('[worker] queue worker started (embedded)');

    // Schedule poller — drives recurring graph ticks
    const { pollSchedules } = await import('@/src/graph/schedule-runner');
    const { createDispatchFunction } = await import('@/src/graph/function-executor');
    const { createDispatchWork } = await import('@/src/graph/work-dispatcher');
    const { executeNode } = await import('@/src/graph/executor');
    const { completeScheduleTick, isScheduleTickComplete } = await import('@/src/graph/schedule');
    const { GraphStore } = await import('@/src/graph/store');

    // Prompt job poller — drives recurring prompt-based scheduled tasks
    const port = getConfiguredLocalServerPort();
    const baseUrl = `http://localhost:${port}`;
    let promptJobPollReady = false;

    // Wait for the server to be ready before polling prompt jobs
    setTimeout(() => { promptJobPollReady = true; }, 5_000);

    setInterval(async () => {
      if (!promptJobPollReady) return;
      try {
        const res = await fetch(`${baseUrl}/api/prompt-jobs/poll`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        });
        if (res.ok) {
          const data = await res.json();
          if (data.queued?.length > 0) {
            console.log(`[prompt-jobs] dispatched ${data.queued.length} run(s)`);
          }
          if (data.skipped?.length > 0) {
            console.log(`[prompt-jobs] skipped ${data.skipped.length} job(s):`, data.skipped.map((s: any) => s.reason));
          }
        }
      } catch {
        // Server not ready or network error — ignore
      }
    }, PROMPT_JOB_POLL_INTERVAL_MS);
    console.log(`[prompt-jobs] poller started (every ${PROMPT_JOB_POLL_INTERVAL_MS / 1000}s)`);

    setInterval(async () => {
      try {
        const dispatchFunction = createDispatchFunction();
        const dispatchWork = createDispatchWork();
        const result = await pollSchedules({ dispatchFunction, dispatchWork });
        if (result.tickedGraphIds.length > 0) {
          console.log(`[schedules] ticked ${result.tickedGraphIds.length} graph(s)`);
        }
        if (result.errors.length > 0) {
          console.error(`[schedules] ${result.errors.length} error(s):`, result.errors.map(e => e.error.message));
        }

        // Option B: dispatch pending work nodes from schedule-ticked graphs
        if (result.pendingWork.length > 0) {
          const store = new GraphStore();

          for (const item of result.pendingWork) {
            let currentGraph = item.graph;
            for (const nodeId of item.nodeIds) {
              try {
                const execResult = await executeNode(currentGraph, nodeId, {
                  dispatchFunction,
                  dispatchWork,
                });
                currentGraph = execResult.graph;
                console.log(`[schedules] dispatched work node "${nodeId}" for graph ${item.taskId}`);
              } catch (err) {
                console.error(`[schedules] work dispatch failed for node "${nodeId}":`, err);
              }
            }

            // Persist work node results and check tick completion
            store.updateGraphStructure(currentGraph.id, {
              nodes: currentGraph.nodes,
            });

            if (isScheduleTickComplete(currentGraph)) {
              const completed = completeScheduleTick(currentGraph);
              store.updateGraphStructure(completed.id, {
                schedule: completed.schedule,
              });
              console.log(`[schedules] tick complete for graph ${item.taskId}`);
            }
          }
        }
      } catch (err) {
        console.error('[schedules] poll failed:', err);
      }
    }, SCHEDULE_POLL_INTERVAL_MS);
    console.log(`[schedules] poller started (every ${SCHEDULE_POLL_INTERVAL_MS / 1000}s)`);
  }
}
