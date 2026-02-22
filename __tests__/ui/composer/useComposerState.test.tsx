/**
 * @jest-environment jsdom
 */

import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { useComposerState, type UseComposerStateOptions } from '../../../ui/composer/hooks/useComposerState';

const VALID_METADATA = {
  scopeLevel: 'task' as const,
  conversationId: 'ctx-1',
  taskId: 'task-1',
  userContext: { userId: 'user-1' },
};

const ComposerStateHarness = ({ options }: { options: UseComposerStateOptions }) => {
  const state = useComposerState(options);
  return (
    <div>
      <button type="button" data-testid="fill-draft" onClick={() => state.handleChange('hello world')} />
      <button type="button" data-testid="send" onClick={() => void state.send()} />
      <span data-testid="metadata-available">{String(state.metadataAvailable)}</span>
      <span data-testid="metadata-presence">{String(state.metadataPresence)}</span>
      <span data-testid="has-error">{String(state.hasError)}</span>
      <span data-testid="error">{state.errorMessage ?? ''}</span>
    </div>
  );
};

describe('useComposerState', () => {
  test('blocks send when metadata is missing', async () => {
    const sendMessageFn = jest.fn();

    const { getByTestId } = render(
      <ComposerStateHarness options={{ metadata: null, sendMessageFn, localeReady: true }} />,
    );

    await act(async () => {
      fireEvent.click(getByTestId('fill-draft'));
    });
    await act(async () => {
      fireEvent.click(getByTestId('send'));
    });

    await waitFor(() => {
      expect(sendMessageFn).not.toHaveBeenCalled();
    });
    expect(getByTestId('metadata-available').textContent).toBe('false');
    expect(getByTestId('metadata-presence').textContent).toBe('false');
    expect(getByTestId('has-error').textContent).toBe('false');
  });

  test('surfaces backend errors and keeps composer disabled', async () => {
    const sendMessageFn = jest.fn().mockRejectedValue(new Error('boom'));
    const { getByTestId } = render(
      <ComposerStateHarness options={{ metadata: VALID_METADATA, sendMessageFn }} />,
    );

    await act(async () => {
      fireEvent.click(getByTestId('fill-draft'));
    });
    await act(async () => {
      fireEvent.click(getByTestId('send'));
    });

    await waitFor(() => {
      expect(getByTestId('error').textContent).toBe('boom');
    });
    expect(sendMessageFn).toHaveBeenCalledTimes(1);
    expect(getByTestId('metadata-available').textContent).toBe('true');
    expect(getByTestId('metadata-presence').textContent).toBe('true');
    expect(getByTestId('has-error').textContent).toBe('true');
  });
});
