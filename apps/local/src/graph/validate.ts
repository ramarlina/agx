import graphlib from "@dagrejs/graphlib";
const { Graph, alg } = graphlib;
type GraphInstance = InstanceType<typeof Graph>;

import type {
  ConditionalNode,
  Edge,
  ExecutionGraph,
  GateNode,
  GraphNode,
  JoinNode,
} from "./types";

type ValidationInvariant =
  | "dag"
  | "depsEdgesConsistency"
  | "requiredGateNonBypass"
  | "conditionalBranchExclusivity"
  | "joinStrategy";

export type ValidationErrors = Record<ValidationInvariant, string[]>;

export interface ValidationResult {
  valid: boolean;
  errors: ValidationErrors;
  topologicalOrder: string[];
}

const HARD_EDGE_TYPE = "hard";
const PATH_ENUMERATION_LIMIT = 20_000;

function createEmptyErrors(): ValidationErrors {
  return {
    dag: [],
    depsEdgesConsistency: [],
    requiredGateNonBypass: [],
    conditionalBranchExclusivity: [],
    joinStrategy: [],
  };
}

function edgeKey(from: string, to: string): string {
  return `${from}=>${to}`;
}

function buildGraphlibGraph(nodeIds: string[], edges: Edge[]): GraphInstance {
  const graphlibGraph = new Graph({ directed: true });

  for (const nodeId of nodeIds) {
    graphlibGraph.setNode(nodeId);
  }

  for (const edge of edges) {
    graphlibGraph.setNode(edge.from);
    graphlibGraph.setNode(edge.to);
    graphlibGraph.setEdge(edge.from, edge.to);
  }

  return graphlibGraph;
}

function collectHardIncomingByTarget(edges: Edge[]): Map<string, Edge[]> {
  const byTarget = new Map<string, Edge[]>();

  for (const edge of edges) {
    if (edge.type !== HARD_EDGE_TYPE) {
      continue;
    }

    const current = byTarget.get(edge.to);
    if (current) {
      current.push(edge);
    } else {
      byTarget.set(edge.to, [edge]);
    }
  }

  return byTarget;
}

function collectHardOutgoingBySource(edges: Edge[]): Map<string, Edge[]> {
  const bySource = new Map<string, Edge[]>();

  for (const edge of edges) {
    if (edge.type !== HARD_EDGE_TYPE) {
      continue;
    }

    const current = bySource.get(edge.from);
    if (current) {
      current.push(edge);
    } else {
      bySource.set(edge.from, [edge]);
    }
  }

  return bySource;
}

function enumeratePathsToSinks(
  graphlibGraph: GraphInstance,
  starts: string[],
  sinks: Set<string>,
): string[][] {
  const paths: string[][] = [];

  const dfs = (current: string, currentPath: string[], visited: Set<string>): void => {
    if (paths.length >= PATH_ENUMERATION_LIMIT) {
      return;
    }

    if (sinks.has(current)) {
      paths.push([...currentPath, current]);
      return;
    }

    const successors = graphlibGraph.successors(current) ?? [];
    for (const next of successors) {
      if (visited.has(next)) {
        continue;
      }

      visited.add(next);
      dfs(next, [...currentPath, current], visited);
      visited.delete(next);
    }
  };

  for (const start of starts) {
    dfs(start, [], new Set([start]));
    if (paths.length >= PATH_ENUMERATION_LIMIT) {
      break;
    }
  }

  return paths;
}

function getRequiredGateIds(nodes: Record<string, GraphNode>): string[] {
  return Object.entries(nodes)
    .filter((entry): entry is [string, GateNode] => {
      const node = entry[1];
      return node.type === "gate" && node.required;
    })
    .map(([nodeId]) => nodeId);
}

function getConditionalEntries(
  nodes: Record<string, GraphNode>,
): Array<[string, ConditionalNode]> {
  return Object.entries(nodes).filter((entry): entry is [string, ConditionalNode] => {
    const node = entry[1];
    return node.type === "conditional";
  });
}

function getJoinEntries(nodes: Record<string, GraphNode>): Array<[string, JoinNode]> {
  return Object.entries(nodes).filter((entry): entry is [string, JoinNode] => {
    const node = entry[1];
    return node.type === "join";
  });
}

function validateDepsAndEdgesConsistency(
  graph: ExecutionGraph,
  errors: ValidationErrors,
): void {
  const nodeIds = new Set(Object.keys(graph.nodes));
  const edgesByKey = new Set(graph.edges.map((edge) => edgeKey(edge.from, edge.to)));

  for (const [nodeId, node] of Object.entries(graph.nodes)) {
    for (const depId of node.deps) {
      if (!nodeIds.has(depId)) {
        errors.depsEdgesConsistency.push(
          `Node "${nodeId}" depends on missing node "${depId}".`,
        );
        continue;
      }

      if (!edgesByKey.has(edgeKey(depId, nodeId))) {
        errors.depsEdgesConsistency.push(
          `Node "${nodeId}" dependency "${depId}" has no matching edge "${depId}" -> "${nodeId}".`,
        );
      }
    }
  }

  for (const edge of graph.edges) {
    if (!nodeIds.has(edge.from)) {
      errors.depsEdgesConsistency.push(
        `Edge "${edge.from}" -> "${edge.to}" references missing source node "${edge.from}".`,
      );
    }

    if (!nodeIds.has(edge.to)) {
      errors.depsEdgesConsistency.push(
        `Edge "${edge.from}" -> "${edge.to}" references missing target node "${edge.to}".`,
      );
      continue;
    }

    const targetNode = graph.nodes[edge.to];
    if (!targetNode.deps.includes(edge.from)) {
      errors.depsEdgesConsistency.push(
        `Edge "${edge.from}" -> "${edge.to}" is not reflected in target deps for "${edge.to}".`,
      );
    }
  }
}

function resolveCompletionSinks(graph: ExecutionGraph, errors: ValidationErrors): string[] {
  const nodeIds = new Set(Object.keys(graph.nodes));
  const hardOutgoingBySource = collectHardOutgoingBySource(graph.edges);

  if (graph.doneCriteria.completionSinkNodeIds?.length) {
    const sinks = graph.doneCriteria.completionSinkNodeIds.filter((sinkId) => {
      if (!nodeIds.has(sinkId)) {
        errors.requiredGateNonBypass.push(
          `completionSinkNodeIds includes unknown node "${sinkId}".`,
        );
        return false;
      }
      return true;
    });

    return [...new Set(sinks)];
  }

  return Object.keys(graph.nodes).filter(
    (nodeId) => (hardOutgoingBySource.get(nodeId)?.length ?? 0) === 0,
  );
}

function validateRequiredGateNonBypass(
  graph: ExecutionGraph,
  errors: ValidationErrors,
): void {
  const requiredGateIds = getRequiredGateIds(graph.nodes);
  if (requiredGateIds.length === 0) {
    return;
  }

  const hardEdges = graph.edges.filter((edge) => edge.type === HARD_EDGE_TYPE);
  const nodeIds = Object.keys(graph.nodes);
  const hardGraph = buildGraphlibGraph(nodeIds, hardEdges);

  const starts = nodeIds.filter((nodeId) => graph.nodes[nodeId].deps.length === 0);
  const sinks = resolveCompletionSinks(graph, errors);

  if (starts.length === 0 || sinks.length === 0) {
    errors.requiredGateNonBypass.push(
      `Cannot evaluate required-gate bypass: found starts=${starts.length}, sinks=${sinks.length}.`,
    );
    return;
  }

  const paths = enumeratePathsToSinks(hardGraph, starts, new Set(sinks));

  if (paths.length >= PATH_ENUMERATION_LIMIT) {
    errors.requiredGateNonBypass.push(
      `Required-gate path enumeration exceeded limit of ${PATH_ENUMERATION_LIMIT} paths.`,
    );
  }

  if (paths.length === 0) {
    errors.requiredGateNonBypass.push(
      "No start-to-sink hard-edge paths found for required-gate validation.",
    );
    return;
  }

  for (const gateId of requiredGateIds) {
    for (const path of paths) {
      if (path.includes(gateId)) {
        continue;
      }

      errors.requiredGateNonBypass.push(
        `Required gate "${gateId}" is bypassed by path: ${path.join(" -> ")}.`,
      );
      break;
    }
  }
}

function validateConditionalBranchExclusivity(
  graph: ExecutionGraph,
  errors: ValidationErrors,
): void {
  const conditionals = getConditionalEntries(graph.nodes);
  if (conditionals.length === 0) {
    return;
  }

  const hardIncomingByTarget = collectHardIncomingByTarget(graph.edges);
  const edgesByKey = new Set(graph.edges.map((edge) => edgeKey(edge.from, edge.to)));

  const validateBranch = (
    conditionalNodeId: string,
    branchName: "thenBranch" | "elseBranch",
    branchNodeIds: Set<string>,
  ): void => {
    for (const branchNodeId of branchNodeIds) {
      if (branchNodeId === conditionalNodeId) {
        errors.conditionalBranchExclusivity.push(
          `Conditional "${conditionalNodeId}" ${branchName} cannot contain the conditional node itself.`,
        );
      }

      if (!(branchNodeId in graph.nodes)) {
        errors.conditionalBranchExclusivity.push(
          `Conditional "${conditionalNodeId}" ${branchName} references missing node "${branchNodeId}".`,
        );
      }
    }

    const roots = [...branchNodeIds].filter((branchNodeId) => {
      const incomingHardEdges = hardIncomingByTarget.get(branchNodeId) ?? [];
      return !incomingHardEdges.some((edge) => branchNodeIds.has(edge.from));
    });

    for (const rootNodeId of roots) {
      const rootNode = graph.nodes[rootNodeId];
      if (!rootNode) {
        continue;
      }

      if (!rootNode.deps.includes(conditionalNodeId)) {
        errors.conditionalBranchExclusivity.push(
          `Conditional "${conditionalNodeId}" ${branchName} root "${rootNodeId}" must depend on "${conditionalNodeId}".`,
        );
      }

      if (!edgesByKey.has(edgeKey(conditionalNodeId, rootNodeId))) {
        errors.conditionalBranchExclusivity.push(
          `Conditional "${conditionalNodeId}" ${branchName} root "${rootNodeId}" is missing direct edge "${conditionalNodeId}" -> "${rootNodeId}".`,
        );
      }
    }

    for (const branchNodeId of branchNodeIds) {
      const incomingHardEdges = hardIncomingByTarget.get(branchNodeId) ?? [];
      for (const incomingEdge of incomingHardEdges) {
        if (
          incomingEdge.from !== conditionalNodeId &&
          !branchNodeIds.has(incomingEdge.from)
        ) {
          errors.conditionalBranchExclusivity.push(
            `Conditional "${conditionalNodeId}" ${branchName} node "${branchNodeId}" has external hard incoming edge from "${incomingEdge.from}".`,
          );
        }
      }
    }
  };

  for (const [conditionalNodeId, node] of conditionals) {
    const thenSet = new Set(node.thenBranch);
    const elseSet = new Set(node.elseBranch);

    for (const branchNodeId of thenSet) {
      if (elseSet.has(branchNodeId)) {
        errors.conditionalBranchExclusivity.push(
          `Conditional "${conditionalNodeId}" has overlapping branch node "${branchNodeId}" in thenBranch and elseBranch.`,
        );
      }
    }

    validateBranch(conditionalNodeId, "thenBranch", thenSet);
    validateBranch(conditionalNodeId, "elseBranch", elseSet);
  }
}

function validateJoinStrategy(graph: ExecutionGraph, errors: ValidationErrors): void {
  for (const [nodeId, node] of getJoinEntries(graph.nodes)) {
    if (node.joinStrategy !== "n_of_m") {
      continue;
    }

    if (node.requiredCount == null) {
      errors.joinStrategy.push(
        `Join "${nodeId}" with joinStrategy "n_of_m" must define requiredCount.`,
      );
      continue;
    }

    if (!Number.isInteger(node.requiredCount)) {
      errors.joinStrategy.push(
        `Join "${nodeId}" requiredCount must be an integer; got ${node.requiredCount}.`,
      );
      continue;
    }

    if (node.requiredCount > node.deps.length) {
      errors.joinStrategy.push(
        `Join "${nodeId}" requiredCount (${node.requiredCount}) exceeds deps length (${node.deps.length}).`,
      );
    }
  }
}

export function validateGraph(graph: ExecutionGraph): ValidationResult {
  const errors = createEmptyErrors();
  const nodeIds = Object.keys(graph.nodes);

  const dagGraph = buildGraphlibGraph(nodeIds, graph.edges);
  const isAcyclic = alg.isAcyclic(dagGraph);
  const topologicalOrder: string[] = [];

  if (!isAcyclic) {
    errors.dag.push("Graph contains at least one directed cycle.");
  }

  try {
    topologicalOrder.push(...alg.topsort(dagGraph));
  } catch {
    // topsort throws when cycles exist; the DAG invariant error is already recorded.
  }

  validateDepsAndEdgesConsistency(graph, errors);
  validateRequiredGateNonBypass(graph, errors);
  validateConditionalBranchExclusivity(graph, errors);
  validateJoinStrategy(graph, errors);

  const valid = Object.values(errors).every((invariantErrors) => invariantErrors.length === 0);

  return {
    valid,
    errors,
    topologicalOrder,
  };
}
