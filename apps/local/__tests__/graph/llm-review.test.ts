/**
 * @jest-environment node
 */

import { buildReviewWorkNode } from '@/src/graph/llm-review';
import type { RootNode } from '@/src/graph/types';

function makeRoot(): RootNode {
  return {
    type: 'root',
    status: 'done',
    deps: [],
    title: 'Spec review',
    objective: 'Validate that the implementation matches the approved spec.',
    criteria: ['Catch missing acceptance criteria coverage'],
    graphCreated: true,
  };
}

describe('llm review prompt', () => {
  test('includes reviewer profile when provided', () => {
    const node = buildReviewWorkNode(makeRoot(), 'diff --git a b', 'gate-1', {
      name: 'Flint',
      voice: 'skeptical, terse',
      seed: 'Look for structural weakness before polish.',
    });

    expect(node.description).toContain('Reviewer: Flint');
    expect(node.description).toContain('Voice: skeptical, terse');
    expect(node.description).toContain('Core orientation: Look for structural weakness before polish.');
    expect(node.description).toContain('Preserve the reviewer\'s distinct perspective');
  });
});
