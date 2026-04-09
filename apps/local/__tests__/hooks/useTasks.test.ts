/**
 * @jest-environment jsdom
 */

import { renderHook, waitFor, act } from '@testing-library/react';

// Mock db
const mockSubscribe = jest.fn().mockReturnThis();
const mockOn = jest.fn().mockReturnThis();
const mockChannel = jest.fn(() => ({
  on: mockOn,
  subscribe: mockSubscribe,
}));
const mockRemoveChannel = jest.fn();

jest.mock('@/lib/db-client', () => ({
  createDbClient: jest.fn(() => ({
    channel: mockChannel,
    removeChannel: mockRemoveChannel,
  })),
}));

jest.mock('@/lib/db', () => ({}));

// Mock fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

// Mock EventSource stream
let mockMessageHandler: ((event: { data: string }) => void) | null = null;
let mockErrorHandler: (() => void) | null = null;
let mockEventSourceInstance: {
  addEventListener: jest.Mock<void, [string, EventListenerOrEventListenerObject]>;
  removeEventListener: jest.Mock<void, [string, EventListenerOrEventListenerObject]>;
  close: jest.Mock<void, []>;
} | null = null;

const createMockEventSource = () => {
  return {
    addEventListener: jest.fn((type, handler) => {
      if (type === "message") {
        mockMessageHandler = handler as (event: { data: string }) => void;
      }
      if (type === "error") {
        mockErrorHandler = handler as () => void;
      }
    }),
    removeEventListener: jest.fn(),
    close: jest.fn(),
  };
};

const MockEventSource = jest.fn(() => {
  mockMessageHandler = null;
  mockErrorHandler = null;
  mockEventSourceInstance = createMockEventSource();
  return mockEventSourceInstance;
});

global.EventSource = MockEventSource as any;

import { useTasks, useTaskComments, useLearnings } from '@/hooks/useTasks';

describe('useTasks', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockReset();
    mockMessageHandler = null;
    mockErrorHandler = null;
    mockEventSourceInstance = null;
  });

  describe('Initial State', () => {
    test('starts with loading state', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ tasks: [] }),
      });

      const { result } = renderHook(() => useTasks());
      
      expect(result.current.isLoading).toBe(true);
      expect(result.current.tasks).toEqual([]);
      
      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });
    });

    test('fetches tasks on mount', async () => {
      const mockTasks = [
        { id: 'task-1', title: 'Task 1', stage: 'coding' },
        { id: 'task-2', title: 'Task 2', stage: 'qa' },
      ];
      
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ tasks: mockTasks }),
      });

      const { result } = renderHook(() => useTasks());
      
      await waitFor(() => {
        expect(result.current.tasks).toEqual(mockTasks);
      });
    });

    test('handles fetch error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'Failed' }),
      });

      const { result } = renderHook(() => useTasks());
      
      await waitFor(() => {
        expect(result.current.error).toBeTruthy();
        expect(result.current.tasks).toEqual([]);
      });
    });
  });

  describe('Filtering', () => {
    test('filters by project', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ tasks: [] }),
      });

      renderHook(() => useTasks({ project: 'my-project' }));
      
      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          expect.stringContaining('project=my-project')
        );
      });
    });

    test('filters by status', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ tasks: [] }),
      });

      renderHook(() => useTasks({ status: 'queued' }));
      
      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          expect.stringContaining('status=queued')
        );
      });
    });
  });

  describe('createTask', () => {
    test('creates task successfully', async () => {
      const newTask = { id: 'new-task', title: 'New Task', stage: 'ideation' };
      
      mockFetch
        .mockResolvedValueOnce({ ok: true, json: async () => ({ tasks: [] }) })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ task: newTask }) });

      const { result } = renderHook(() => useTasks());
      
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      let createdTask;
      await act(async () => {
        createdTask = await result.current.createTask('# New Task');
      });

      expect(createdTask).toEqual(newTask);
      expect(mockFetch).toHaveBeenCalledWith('/api/tasks', expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('New Task'),
      }));
    });

    test('throws on create error', async () => {
      mockFetch
        .mockResolvedValueOnce({ ok: true, json: async () => ({ tasks: [] }) })
        .mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'Create failed' }) });

      const { result } = renderHook(() => useTasks());
      
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      await expect(
        result.current.createTask('# Failed Task')
      ).rejects.toThrow('Create failed');
    });
  });

  describe('updateTask', () => {
    test('updates task successfully', async () => {
      const updatedTask = { id: 'task-1', title: 'Updated', stage: 'qa' };
      
      mockFetch
        .mockResolvedValueOnce({ ok: true, json: async () => ({ tasks: [] }) })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ task: updatedTask }) });

      const { result } = renderHook(() => useTasks());
      
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      let updated;
      await act(async () => {
        updated = await result.current.updateTask('task-1', { stage: 'qa' });
      });

      expect(updated).toEqual(updatedTask);
      expect(mockFetch).toHaveBeenCalledWith('/api/tasks/task-1', expect.objectContaining({
        method: 'PATCH',
      }));
    });

    test('throws on update error', async () => {
      mockFetch
        .mockResolvedValueOnce({ ok: true, json: async () => ({ tasks: [] }) })
        .mockResolvedValueOnce({
          ok: false,
          status: 400,
          statusText: 'Bad Request',
          json: async () => ({ error: 'Invalid stage value' }),
        });

      const { result } = renderHook(() => useTasks());
      
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      await expect(
        result.current.updateTask('task-1', { stage: 'qa' })
      ).rejects.toThrow('Invalid stage value');
    });
  });

  describe('deleteTask', () => {
    test('deletes task successfully', async () => {
      mockFetch
        .mockResolvedValueOnce({ ok: true, json: async () => ({ tasks: [{ id: 'task-1' }] }) })
        .mockResolvedValueOnce({ ok: true });

      const { result } = renderHook(() => useTasks());
      
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      await act(async () => {
        await result.current.deleteTask('task-1');
      });

      expect(mockFetch).toHaveBeenCalledWith('/api/tasks/task-1', { method: 'DELETE' });
    });

    test('throws on delete error', async () => {
      mockFetch
        .mockResolvedValueOnce({ ok: true, json: async () => ({ tasks: [] }) })
        .mockResolvedValueOnce({ ok: false });

      const { result } = renderHook(() => useTasks());
      
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      await expect(
        result.current.deleteTask('task-1')
      ).rejects.toThrow('Failed to delete task');
    });
  });



  describe('refetch', () => {
    test('refetches tasks', async () => {
      mockFetch
        .mockResolvedValueOnce({ ok: true, json: async () => ({ tasks: [] }) })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ tasks: [{ id: 'task-1' }] }) });

      const { result } = renderHook(() => useTasks());
      
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      await act(async () => {
        await result.current.refetch();
      });

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(result.current.tasks).toHaveLength(1);
    });
  });

  describe('Realtime Updates', () => {
    test('subscribes to realtime when enabled', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ tasks: [] }) });

      renderHook(() => useTasks({ realtime: true }));
      
      await waitFor(() => {
        expect(mockChannel).toHaveBeenCalledWith('tasks-changes');
      });
    });

    test('does not subscribe when realtime is disabled', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ tasks: [] }) });

      renderHook(() => useTasks({ realtime: false }));
      
      await waitFor(() => {
        expect(mockChannel).not.toHaveBeenCalled();
      });
    });

    test('cleans up subscription on unmount', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ tasks: [] }) });

      const { unmount } = renderHook(() => useTasks({ realtime: true }));
      
      await waitFor(() => expect(mockChannel).toHaveBeenCalled());

      unmount();

      expect(mockRemoveChannel).toHaveBeenCalled();
    });
  });

  describe('tasks stream', () => {
    test('connects to SSE stream and merges updates', async () => {
      const initialTask = {
        id: 'task-1',
        content: '',
        stage: 'ideation',
        created_at: '2025-01-01T00:00:00.000Z',
        updated_at: '2025-01-01T00:00:00.000Z',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ tasks: [initialTask] }),
      });

      const { result, unmount } = renderHook(() => useTasks({ realtime: true }));

      await waitFor(() => {
        expect(MockEventSource).toHaveBeenCalledWith('/api/tasks/stream');
      });

      const updatedTask = { ...initialTask, stage: 'qa', title: 'Updated', id: 'task-1' };

      act(() => {
        mockMessageHandler?.({ data: JSON.stringify({ type: 'UPDATE', task: updatedTask }) } as MessageEvent);
      });

      await waitFor(() => {
        expect(result.current.tasks).toContainEqual(updatedTask);
      });

      unmount();
      expect(mockEventSourceInstance?.close).toHaveBeenCalled();
    });

    test('refetches when SSE stream errors', async () => {
      mockFetch
        .mockResolvedValueOnce({ ok: true, json: async () => ({ tasks: [] }) })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ tasks: [] }) });

      renderHook(() => useTasks({ realtime: true }));

      await waitFor(() => {
        expect(MockEventSource).toHaveBeenCalled();
      });

      act(() => {
        mockErrorHandler?.();
      });

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledTimes(2);
      });
    });
  });

  describe('cancelWorkflow', () => {
    test('requests cancel and clears state on success', async () => {
      mockFetch
        .mockResolvedValueOnce({ ok: true, json: async () => ({ tasks: [] }) })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) });

      const { result } = renderHook(() => useTasks());

      await waitFor(() => expect(result.current.isLoading).toBe(false));

      await act(async () => {
        await result.current.cancelWorkflow({
          taskId: 'task-1',
          reason: 'Stop now',
        });
      });

      expect(mockFetch).toHaveBeenLastCalledWith(
        '/api/orchestrator/tasks/task-1/cancel',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: 'Stop now' }),
        })
      );
      expect(result.current.cancellingTaskId).toBeNull();
      expect(result.current.cancelError).toBeNull();
    });

    test('captures failures and surfaces error message', async () => {
      mockFetch
        .mockResolvedValueOnce({ ok: true, json: async () => ({ tasks: [] }) })
        .mockResolvedValueOnce({
          ok: false,
          json: async () => ({ error: 'Already completed' }),
        });

      const { result } = renderHook(() => useTasks());

      await waitFor(() => expect(result.current.isLoading).toBe(false));

      await act(async () => {
        await expect(
          result.current.cancelWorkflow({ taskId: 'task-2' })
        ).rejects.toThrow('Already completed');
      });

      await waitFor(() => {
        expect(result.current.cancelError?.message).toBe('Already completed');
        expect(result.current.cancellingTaskId).toBeNull();
      });

      expect(mockFetch).toHaveBeenLastCalledWith(
        '/api/orchestrator/tasks/task-2/cancel',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        })
      );
    });
  });
});

describe('useTaskComments', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockReset();
  });

  test('fetches comments for task', async () => {
    const mockComments = [
      { id: 'comment-1', content: 'Comment 1', created_at: '2024-01-01' },
      { id: 'comment-2', content: 'Comment 2', created_at: '2024-01-02' },
    ];
    
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ comments: mockComments }),
    });

    const { result } = renderHook(() => useTaskComments('task-123'));
    
    await waitFor(() => {
      expect(result.current.comments).toEqual(mockComments);
    });
  });

  test('does not fetch when taskId is null', async () => {
    renderHook(() => useTaskComments(null));
    
    // Wait a bit to ensure no fetch happens
    await new Promise(r => setTimeout(r, 100));
    
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test('addComment adds comment entry', async () => {
    const mockComment = { id: 'comment-new', content: 'New comment', created_at: '2024-01-03' };
    
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ comments: [] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ comment: mockComment }) });

    const { result } = renderHook(() => useTaskComments('task-123'));
    
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.addComment('New comment');
    });

    expect(mockFetch).toHaveBeenCalledWith('/api/tasks/task-123/comments', expect.objectContaining({
      method: 'POST',
      body: expect.stringContaining('New comment'),
    }));
  });
});

describe('useLearnings', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockReset();
  });

  test('fetches learnings', async () => {
    const mockLearnings = [
      { id: 'learn-1', content: 'Learning 1', scope: 'project' },
    ];
    
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ learnings: mockLearnings }),
    });

    const { result } = renderHook(() => useLearnings('project', 'proj-1'));
    
    await waitFor(() => {
      expect(result.current.learnings).toEqual(mockLearnings);
    });
  });

  test('addLearning adds learning', async () => {
    const newLearning = { id: 'learn-2', content: 'New learning', scope: 'project' };
    
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ learnings: [] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ learning: newLearning }) });

    const { result } = renderHook(() => useLearnings());
    
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let added;
    await act(async () => {
      added = await result.current.addLearning('New learning', 'project', 'proj-1');
    });

    expect(added).toEqual(newLearning);
    expect(mockFetch).toHaveBeenCalledWith('/api/learnings', expect.objectContaining({
      method: 'POST',
    }));
  });

  test('deleteLearning removes learning', async () => {
    const mockLearnings = [{ id: 'learn-1', content: 'To delete', scope: 'project' }];
    
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ learnings: mockLearnings }) })
      .mockResolvedValueOnce({ ok: true });

    const { result } = renderHook(() => useLearnings());
    
    await waitFor(() => expect(result.current.learnings).toHaveLength(1));

    await act(async () => {
      await result.current.deleteLearning('learn-1');
    });

    expect(result.current.learnings).toHaveLength(0);
    expect(mockFetch).toHaveBeenCalledWith('/api/learnings?id=learn-1', { method: 'DELETE' });
  });
});
