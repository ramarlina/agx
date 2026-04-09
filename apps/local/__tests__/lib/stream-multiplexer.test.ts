/**
 * @jest-environment node
 */

import { buildParticipantIdentity, seedFromIdentityText } from '@/lib/stream-multiplexer';

describe('stream multiplexer identity assembly', () => {
  test('derives a distinct runtime seed from identity text instead of collapsing to the default', () => {
    const seed = seedFromIdentityText(
      'You are Flint. Approach reviews like a skeptical systems engineer and call out weak assumptions first.',
      'Flint',
    );

    expect(seed).toContain('I am Flint.');
    expect(seed).toContain('skeptical systems engineer');
    expect(seed).not.toBe('I am Flint. I evolve through experience and collaboration.');
  });

  test('builds identity prompt from description, voice, and seed', () => {
    const identity = buildParticipantIdentity({
      id: 'flint',
      name: 'Flint',
      provider: 'claude',
      model: 'gpt-5',
      color: '#000000',
      identity: 'Focus on structural risk and hidden assumptions.',
      voice: 'dry, direct, skeptical',
      seed: 'Pressure-test plans before approving them.',
    });

    expect(identity).toContain('Focus on structural risk and hidden assumptions.');
    expect(identity).toContain('Voice: dry, direct, skeptical');
    expect(identity).toContain('Core orientation: Pressure-test plans before approving them.');
  });
});
