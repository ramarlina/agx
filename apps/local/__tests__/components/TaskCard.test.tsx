import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import TaskCard, { Task } from '@/components/TaskCard';

describe('TaskCard', () => {
  const mockTask: Task = {
    id: 'task-1',
    content: '# Test Task\n\nDescription here',
    title: 'Test Task',
    status: 'in_progress',
    stage: 'PROGRESS',
    project: 'my-project',
    priority: 2,
    engine: 'claude',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  describe('Rendering', () => {
    test('renders task title', () => {
      render(<TaskCard task={mockTask} />);
      expect(screen.getByText('Test Task')).toBeInTheDocument();
    });

    test('renders priority when provided', () => {
      render(<TaskCard task={mockTask} />);
      expect(screen.getByText('P2')).toBeInTheDocument();
    });

    test('renders truncated task id on hover area', () => {
      render(<TaskCard task={mockTask} />);
      expect(screen.getByText('task-')).toBeInTheDocument();
    });
  });

  describe('Click Handling', () => {
    test('calls onClick when card is clicked', () => {
      const mockOnClick = jest.fn();
      render(<TaskCard task={mockTask} onClick={mockOnClick} />);

      fireEvent.click(screen.getByText('Test Task'));

      expect(mockOnClick).toHaveBeenCalled();
    });

    test('works without onClick handler', () => {
      expect(() => {
        render(<TaskCard task={mockTask} />);
        fireEvent.click(screen.getByText('Test Task'));
      }).not.toThrow();
    });
  });

  describe('Optional Fields', () => {
    test('renders without priority', () => {
      const task: Task = { ...mockTask, priority: undefined };
      render(<TaskCard task={task} />);
      expect(screen.queryByText(/^P\d$/)).not.toBeInTheDocument();
    });

    test('renders without stage', () => {
      const task: Task = { ...mockTask, stage: undefined };
      expect(() => render(<TaskCard task={task} />)).not.toThrow();
    });

    test('renders with fallback title for untitled tasks', () => {
      const task: Task = { ...mockTask, title: undefined };
      render(<TaskCard task={task} />);
      expect(screen.getByText('Untitled Task')).toBeInTheDocument();
    });
  });
});
