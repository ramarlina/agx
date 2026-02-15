/* eslint-disable no-console */
'use strict';

const os = require('os');
const { tick: schedulerTick } = require('../../graph/scheduler');
const { DEFAULT_EXECUTION_POLICY, INCOMPLETE_FOR_DONE_STATUSES } = require('../../graph/types');
const { runVerifyGate } = require('../../verify-gate');

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function nowIso() {
  return new Date().toISOString();
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function readEmbeddedGraph(task) {
  const candidates = [
    task?.execution_graph,
    task?.executionGraph,
    task?.graph,
  ];
  for (const candidate of candidates) {
    const obj = asObject(candidate);
    if (obj) return deepClone(obj);
  }
  return null;
}

function readGraphFromResponse(response) {
  if (!response) return null;
  if (asObject(response?.graph)) return deepClone(response.graph);
  if (asObject(response?.execution_graph)) return deepClone(response.execution_graph);
  if (asObject(response?.executionGraph)) return deepClone(response.executionGraph);
  if (asObject(response)) return deepClone(response);
  return null;
}

function normalizeGraph(graph, taskId) {
  const normalized = asObject(graph);
  if (!normalized) return null;

  if (!normalized.id && typeof normalized.graph_id === 'string' && normalized.graph_id.trim()) {
    normalized.id = normalized.graph_id.trim();
  }
  if (!normalized.taskId) normalized.taskId = taskId;
  if (!normalized.mode) normalized.mode = 'PROJECT';
  if (!Number.isInteger(normalized.graphVersion) || normalized.graphVersion < 1) {
    normalized.graphVersion = 1;
  }
  if (!asObject(normalized.policy)) normalized.policy = {};
  normalized.policy = { ...DEFAULT_EXECUTION_POLICY, ...normalized.policy };
  if (!asObject(normalized.doneCriteria)) {
    normalized.doneCriteria = {
      allRequiredGatesPassed: true,
      noRunnableOrPendingWork: true,
      completionSinkNodeIds: [],
      customCriteria: [],
    };
  }
  if (!asObject(normalized.nodes)) normalized.nodes = {};
  if (!Array.isArray(normalized.edges)) normalized.edges = [];
  if (!Array.isArray(normalized.runtimeEvents)) normalized.runtimeEvents = [];

  return normalized;
}

function assertGraphShape(graph, taskId) {
  if (!graph) throw new Error(`[v2-required] Task ${taskId} has no execution graph payload.`);
  if (typeof graph.id !== 'string' || !graph.id.trim()) {
    throw new Error(`[v2-required] Task ${taskId} graph is missing id.`);
  }
  if (!asObject(graph.nodes)) {
    throw new Error(`[v2-required] Task ${taskId} graph.nodes must be an object.`);
  }
  if (!Array.isArray(graph.edges)) {
    throw new Error(`[v2-required] Task ${taskId} graph.edges must be an array.`);
  }
}

function nodeStatusFingerprint(graph) {
  return Object.keys(graph.nodes || {})
    .sort()
    .map((nodeId) => `${nodeId}:${graph.nodes[nodeId]?.status || 'unknown'}`)
    .join('|');
}

function isNodeIncomplete(status) {
  return INCOMPLETE_FOR_DONE_STATUSES.includes(status);
}

function collectNodeIdsByStatus(graph, statuses) {
  const allowed = new Set(statuses);
  return Object.keys(graph.nodes || {}).filter((nodeId) => allowed.has(graph.nodes[nodeId]?.status));
}

function unresolvedPendingNodes(graph) {
  return collectNodeIdsByStatus(graph, ['pending', 'blocked', 'awaiting_human']);
}

function hasIncompleteNodes(graph) {
  return Object.values(graph.nodes || {}).some((node) => node && isNodeIncomplete(node.status));
}

function hasFailedNodes(graph) {
  return Object.values(graph.nodes || {}).some((node) => node && node.status === 'failed');
}

function allCompletionSinksPassed(graph) {
  const sinkIds = Array.isArray(graph?.doneCriteria?.completionSinkNodeIds)
    ? graph.doneCriteria.completionSinkNodeIds
    : [];
  if (sinkIds.length === 0) return !hasFailedNodes(graph);
  return sinkIds.every((nodeId) => {
    const status = graph.nodes?.[nodeId]?.status;
    return status === 'done' || status === 'passed';
  });
}

function buildWorkNodePrompt({ task, nodeId, node }) {
  const taskTitle = String(task?.title || task?.goal || task?.user_request || '').trim() || 'Untitled task';
  const nodeTitle = String(node?.title || '').trim() || nodeId;
  const nodeDescription = String(node?.description || '').trim();

  return [
    'EXECUTE WORK NODE',
    '',
    `Task: ${taskTitle}`,
    `Node ID: ${nodeId}`,
    `Node Title: ${nodeTitle}`,
    nodeDescription ? `Node Description: ${nodeDescription}` : null,
    '',
    'Do the work required for this node. Apply changes directly to the repository.',
    'Keep output concise and include a short implementation summary and verification notes.',
  ].filter(Boolean).join('\n');
}

function buildVerificationChecks(node) {
  const checks = node?.verificationStrategy?.checks;
  if (!Array.isArray(checks)) return [];
  return checks
    .map((item) => String(item || '').trim())
    .filter(Boolean);
}

async function loadGraphForTask({ taskId, task, cloudRequest }) {
  const embedded = readEmbeddedGraph(task);
  if (embedded) return normalizeGraph(embedded, taskId);

  if (typeof cloudRequest !== 'function') {
    throw new Error(`[v2-required] Task ${taskId} missing embedded graph and no cloud graph loader is available.`);
  }

  let response;
  try {
    response = await cloudRequest('GET', `/api/tasks/${taskId}/graph`);
  } catch (err) {
    throw new Error(`[v2-required] Failed to load graph for task ${taskId} via GET /api/tasks/${taskId}/graph: ${err?.message || err}`);
  }

  const parsed = normalizeGraph(readGraphFromResponse(response), taskId);
  if (!parsed) {
    throw new Error(`[v2-required] Graph endpoint returned invalid payload for task ${taskId}.`);
  }
  return parsed;
}

async function persistGraphToCloud({ cloudRequest, taskId, graph }) {
  if (typeof cloudRequest !== 'function') return graph;

  const payloads = [
    { graph, ifMatchGraphVersion: graph.graphVersion },
    {
      graphId: graph.id,
      mode: graph.mode,
      nodes: graph.nodes,
      edges: graph.edges,
      policy: graph.policy,
      doneCriteria: graph.doneCriteria,
      runtimeEvents: graph.runtimeEvents,
      status: graph.status,
      startedAt: graph.startedAt,
      completedAt: graph.completedAt,
      timedOutAt: graph.timedOutAt,
      ifMatchGraphVersion: graph.graphVersion,
    },
  ];

  let lastErr = null;
  for (const payload of payloads) {
    try {
      const response = await cloudRequest('PATCH', `/api/tasks/${taskId}/graph`, payload);
      const responseGraph = normalizeGraph(readGraphFromResponse(response), taskId);
      if (!responseGraph) return graph;
      return responseGraph;
    } catch (err) {
      lastErr = err;
    }
  }

  throw new Error(`[v2-required] Failed to persist graph for task ${taskId} via PATCH /api/tasks/${taskId}/graph: ${lastErr?.message || lastErr}`);
}

function makeDecision({ outcome, message, nextPrompt = '', graph, extra = {} }) {
  return {
    done: outcome === 'done',
    decision: outcome,
    explanation: message,
    final_result: message,
    next_prompt: nextPrompt,
    summary: message,
    graph_id: graph?.id || null,
    graph_version: graph?.graphVersion || null,
    ...extra,
  };
}

function createCloudExecuteGraphV2(env) {
  const {
    logExecutionFlow,
    abortIfCancelled,
    createDaemonArtifactsRecorder,
    runSingleAgentIteration,
    buildLocalRunIndexEntry,
    finalizeRunSafe,
  } = env || {};

  const baseProcEnv = typeof process !== 'undefined' && process.env ? process.env : {};

  async function executeWorkNode({
    taskId,
    task,
    provider,
    model,
    nodeId,
    node,
    graphRun,
    artifacts,
    logger,
    cancellationWatcher,
  }) {
    const prompt = buildWorkNodePrompt({ task, nodeId, node });
    artifacts.recordPrompt(`Node Prompt (${nodeId})`, prompt);

    const output = await runSingleAgentIteration({
      taskId,
      task,
      provider,
      model,
      prompt,
      env: {
        ...baseProcEnv,
        AGX_RUN_ROOT: graphRun?.paths?.root || '',
        AGX_RUN_PLAN_DIR: graphRun?.paths?.plan || '',
        AGX_RUN_ARTIFACTS_DIR: graphRun?.paths?.artifacts || '',
      },
      logger,
      artifacts,
      cancellationWatcher,
      cwd: os.homedir(),
    });

    artifacts.recordOutput(`Node Output (${nodeId})`, output || '');
    return output;
  }

  async function executeGateNode({ node, cwd, onLog }) {
    const strategy = String(node?.verificationStrategy?.type || 'auto').toLowerCase();
    if (strategy === 'human') {
      return {
        status: 'awaiting_human',
        verificationResult: {
          passed: false,
          checks: [],
          verifiedAt: nowIso(),
          verifiedBy: 'human',
        },
        reason: 'Gate requires human verification.',
      };
    }

    const checks = buildVerificationChecks(node);
    const gateResult = await runVerifyGate({
      criteria: checks,
      cwd,
      verifyFailures: Number(node?.verifyFailures || 0),
      onLog: (line) => onLog?.(line),
    });

    if (gateResult.forceAction) {
      return {
        status: 'failed',
        verificationResult: {
          passed: false,
          checks: gateResult.results || [],
          verifiedAt: nowIso(),
          verifiedBy: 'agent',
        },
        reason: gateResult.reason || 'Verification gate exhausted retries.',
        verifyFailures: gateResult.verifyFailures,
      };
    }

    if (gateResult.needsLlm) {
      return {
        status: 'awaiting_human',
        verificationResult: {
          passed: false,
          checks: gateResult.results || [],
          verifiedAt: nowIso(),
          verifiedBy: 'agent',
        },
        reason: 'Gate includes semantic checks and requires human verification.',
        verifyFailures: gateResult.verifyFailures,
      };
    }

    return {
      status: gateResult.passed ? 'passed' : 'failed',
      verificationResult: {
        passed: Boolean(gateResult.passed),
        checks: gateResult.results || [],
        verifiedAt: nowIso(),
        verifiedBy: 'agent',
      },
      reason: gateResult.passed ? 'Gate checks passed.' : 'Gate checks failed.',
      verifyFailures: gateResult.verifyFailures,
    };
  }

  async function runV2GraphExecutionLoop({
    taskId,
    task,
    provider,
    model,
    logger,
    storage,
    projectSlug,
    taskSlug,
    stageLocal,
    initialPromptContext,
    cancellationWatcher,
    cloudRequest,
  }) {
    logExecutionFlow('runV2GraphExecutionLoop', 'input', `taskId=${taskId}, provider=${provider}, model=${model}, stage=${stageLocal}`);

    const maxTicksRaw = Number(process.env.AGX_V2_MAX_TICKS || 200);
    const maxTicks = Number.isFinite(maxTicksRaw) && maxTicksRaw > 0 ? Math.floor(maxTicksRaw) : 200;

    const graphRun = await storage.createRun({
      projectSlug,
      taskSlug,
      stage: stageLocal || 'execute',
      engine: provider,
      model: model || undefined,
    });
    const artifacts = createDaemonArtifactsRecorder({ storage, run: graphRun, taskId });
    if (initialPromptContext) {
      artifacts.recordPrompt('Initial Task Context', initialPromptContext);
    }
    try {
      let graph = await loadGraphForTask({ taskId, task, cloudRequest });
      assertGraphShape(graph, taskId);

      graph.startedAt = graph.startedAt || nowIso();
      artifacts.recordOutput('Graph Loaded', JSON.stringify({
        graphId: graph.id,
        graphVersion: graph.graphVersion,
        mode: graph.mode,
        nodeCount: Object.keys(graph.nodes || {}).length,
        edgeCount: Array.isArray(graph.edges) ? graph.edges.length : 0,
      }, null, 2));

      await storage.writeTaskGraph(projectSlug, taskSlug, graph);
      graph = await persistGraphToCloud({ cloudRequest, taskId, graph });
      assertGraphShape(graph, taskId);

      let tickCount = 0;
      let stalledTicks = 0;
      let previousFingerprint = nodeStatusFingerprint(graph);

      while (tickCount < maxTicks) {
        tickCount += 1;
        await abortIfCancelled(cancellationWatcher);
        logExecutionFlow('runV2GraphExecutionLoop', 'processing', `taskId=${taskId}, tick=${tickCount}`);

        const tickNow = nowIso();
        const tickResult = schedulerTick(graph, { now: tickNow });
        graph = tickResult?.graph ? tickResult.graph : graph;
        if (!Array.isArray(graph.runtimeEvents)) graph.runtimeEvents = [];
        for (const event of (tickResult?.events || [])) {
          graph.runtimeEvents.push({
            ...event,
            graphId: graph.id,
            timestamp: event?.timestamp || tickNow,
          });
        }

        const runnableNodeIds = collectNodeIdsByStatus(graph, ['running']);
        let progressedThisTick = false;

        for (const nodeId of runnableNodeIds) {
          const node = graph.nodes[nodeId];
          if (!node || node.status !== 'running') continue;

          const startedAt = node.startedAt || tickNow;
          const startedMs = Date.parse(startedAt);
          node.startedAt = startedAt;

          if (node.type === 'work') {
            try {
              const output = await executeWorkNode({
                taskId,
                task,
                provider,
                model,
                nodeId,
                node,
                graphRun,
                artifacts,
                logger,
                cancellationWatcher,
              });
              node.status = 'done';
              node.error = undefined;
              node.output = {
                ...(asObject(node.output) || {}),
                summary: String(output || '').slice(0, 8000),
                completedAt: nowIso(),
              };
              progressedThisTick = true;
            } catch (err) {
              const attempts = Number(node.attempts || 0) + 1;
              node.attempts = attempts;
              node.error = String(err?.message || err || 'work node failed');
              const maxAttempts = Number.isInteger(node.maxAttempts) ? node.maxAttempts : 1;
              if (attempts < maxAttempts) {
                node.status = 'pending';
              } else {
                node.status = 'failed';
                node.completedAt = nowIso();
              }
              progressedThisTick = true;
            }
          } else if (node.type === 'gate') {
            const gateResult = await executeGateNode({
              node,
              cwd: os.homedir(),
              onLog: (line) => logger?.log?.('system', `[v2-gate][${nodeId}] ${line}\n`),
            });
            node.status = gateResult.status;
            node.verificationResult = gateResult.verificationResult;
            node.verifyFailures = gateResult.verifyFailures;
            node.error = gateResult.status === 'failed' ? gateResult.reason : undefined;
            progressedThisTick = true;
          } else {
            node.status = 'done';
            progressedThisTick = true;
          }

          if (node.status === 'done' || node.status === 'passed' || node.status === 'failed' || node.status === 'skipped') {
            node.completedAt = node.completedAt || nowIso();
            if (Number.isFinite(startedMs)) {
              const elapsedMs = Math.max(0, Date.now() - startedMs);
              node.actualMinutes = Math.max(1, Math.round(elapsedMs / 60000));
            }
          }
        }

        graph.updatedAt = nowIso();
        await storage.writeTaskGraph(projectSlug, taskSlug, graph);
        graph = await persistGraphToCloud({ cloudRequest, taskId, graph });
        assertGraphShape(graph, taskId);

        const fingerprint = nodeStatusFingerprint(graph);
        if (progressedThisTick || fingerprint !== previousFingerprint) {
          stalledTicks = 0;
        } else {
          stalledTicks += 1;
        }
        previousFingerprint = fingerprint;

        if (!hasIncompleteNodes(graph)) {
          graph.completedAt = graph.completedAt || nowIso();
          graph.status = allCompletionSinksPassed(graph) ? 'done' : 'failed';
          await storage.writeTaskGraph(projectSlug, taskSlug, graph);
          graph = await persistGraphToCloud({ cloudRequest, taskId, graph });
          await finalizeRunSafe(storage, graphRun, {
            status: graph.status === 'done' ? 'done' : 'failed',
            reason: graph.status === 'done'
              ? `v2 graph completed (${graph.id})`
              : `v2 graph finished with failed nodes (${graph.id})`,
          });

          const summary = graph.status === 'done'
            ? `v2 graph ${graph.id} completed successfully (version ${graph.graphVersion}).`
            : `v2 graph ${graph.id} finished with failures (version ${graph.graphVersion}).`;

          artifacts.recordOutput('Graph Final State', JSON.stringify({
            graphId: graph.id,
            graphVersion: graph.graphVersion,
            status: graph.status,
            completedAt: graph.completedAt,
          }, null, 2));
          await artifacts.flush();

          const runIndexEntry = await buildLocalRunIndexEntry(storage, graphRun, graph.status);
          return {
            code: graph.status === 'done' ? 0 : 1,
            decision: makeDecision({
              outcome: graph.status === 'done' ? 'done' : 'failed',
              message: summary,
              graph,
            }),
            lastRun: graphRun,
            runIndexEntry,
          };
        }

        const awaitingHuman = collectNodeIdsByStatus(graph, ['awaiting_human']);
        if (awaitingHuman.length > 0) {
          await finalizeRunSafe(storage, graphRun, {
            status: 'blocked',
            reason: `v2 graph awaiting human verification (${awaitingHuman.join(', ')})`,
          });
          await artifacts.flush();
          const runIndexEntry = await buildLocalRunIndexEntry(storage, graphRun, 'blocked');
          return {
            code: 1,
            decision: makeDecision({
              outcome: 'blocked',
              message: `v2 graph ${graph.id} requires human verification for: ${awaitingHuman.join(', ')}`,
              nextPrompt: 'Complete required human verification and re-run.',
              graph,
            }),
            lastRun: graphRun,
            runIndexEntry,
          };
        }

        if (stalledTicks >= 3) {
          const blockers = unresolvedPendingNodes(graph);
          await finalizeRunSafe(storage, graphRun, {
            status: 'blocked',
            reason: `v2 graph stalled: ${blockers.join(', ') || 'no runnable nodes'}`,
          });
          await artifacts.flush();
          const runIndexEntry = await buildLocalRunIndexEntry(storage, graphRun, 'blocked');
          return {
            code: 1,
            decision: makeDecision({
              outcome: 'blocked',
              message: `v2 graph ${graph.id} stalled; no runnable nodes after ${stalledTicks} ticks.`,
              nextPrompt: blockers.length
                ? `Investigate blocked nodes: ${blockers.join(', ')}`
                : 'Investigate graph dependencies and node statuses.',
              graph,
            }),
            lastRun: graphRun,
            runIndexEntry,
          };
        }
      }

      await finalizeRunSafe(storage, graphRun, {
        status: 'failed',
        reason: `v2 graph exceeded max ticks (${maxTicks}).`,
      });
      await artifacts.flush();
      const runIndexEntry = await buildLocalRunIndexEntry(storage, graphRun, 'failed');
      return {
        code: 1,
        decision: makeDecision({
          outcome: 'failed',
          message: `v2 graph execution exceeded max ticks (${maxTicks}) without completion.`,
          graph,
        }),
        lastRun: graphRun,
        runIndexEntry,
      };
    } catch (err) {
      const message = String(err?.message || err || 'v2 graph execution failed');
      artifacts.recordOutput('V2 Graph Error', message);
      await artifacts.flush();
      if (!graphRun?.finalized) {
        try {
          await storage.failRun(graphRun, {
            error: message,
            code: 'V2_GRAPH_EXECUTION_FAILED',
          });
        } catch { }
      }
      throw err;
    }
  }

  return { runV2GraphExecutionLoop };
}

module.exports = { createCloudExecuteGraphV2 };
