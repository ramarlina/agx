import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

import { AddNodeCommentRequestSchema, ErrorResponseSchema } from "@/src/graph/api-schemas";
import {
  jsonWithSchema,
  normalizeNodeId,
  normalizeTaskId,
  parseJsonBody,
} from "@/src/graph/api-route-utils";
import { getGraph, updateNodeRuntime } from "@/src/graph/store";
import type { NodeComment } from "@/src/graph/types";

interface RouteParams {
  params: Promise<{ id: string; nodeId: string }>;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id: taskId, nodeId } = await params;
  const normalizedTaskId = normalizeTaskId(taskId);
  const normalizedNodeId = normalizeNodeId(nodeId);
  if (!normalizedTaskId || !normalizedNodeId) {
    return jsonWithSchema(ErrorResponseSchema, { error: "Invalid taskId or nodeId" }, { status: 400 });
  }

  const parsedBody = await parseJsonBody(request, AddNodeCommentRequestSchema);
  if (!parsedBody.ok) {
    return parsedBody.response;
  }

  const graph = await getGraph(normalizedTaskId);
  if (!graph) {
    return jsonWithSchema(ErrorResponseSchema, { error: "Graph not found" }, { status: 404 });
  }

  const node = graph.nodes[normalizedNodeId];
  if (!node) {
    return jsonWithSchema(ErrorResponseSchema, { error: "Node not found" }, { status: 404 });
  }

  const existingComments: NodeComment[] = node.comments ?? [];
  const newComment: NodeComment = {
    id: randomUUID(),
    content: parsedBody.data.content,
    author: "user",
    createdAt: new Date().toISOString(),
  };

  const result = await updateNodeRuntime(
    graph.id,
    {
      [normalizedNodeId]: {
        configPatch: {
          comments: [...existingComments, newComment],
        },
      },
    },
    graph.graphVersion,
  );

  if ("error" in result) {
    return jsonWithSchema(ErrorResponseSchema, { error: result.error }, { status: 409 });
  }

  return NextResponse.json(newComment, { status: 201 });
}
