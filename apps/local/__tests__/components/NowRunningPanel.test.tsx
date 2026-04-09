/**
 * @jest-environment jsdom
 */

import { render, screen, fireEvent } from "@testing-library/react";
import NowRunningPanel from "@/components/NowRunningPanel";
import { Task } from "@/components/TaskCard";

describe("NowRunningPanel", () => {
  const baseTask: Task = {
    id: "task-1",
    content: "Test task",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    status: "in_progress",
  };

  test("renders stop button and calls handler", () => {
    const onStop = jest.fn();
    const onRetry = jest.fn();

    render(
      <NowRunningPanel
        tasks={[baseTask]}
        onStop={onStop}
        onRetry={onRetry}
      />
    );

    const stopButton = screen.getByRole("button", { name: "Stop Task" });
    fireEvent.click(stopButton);
    expect(onStop).toHaveBeenCalledWith("task-1");
  });

  test("disables stop button and shows spinner when cancelling", () => {
    render(
      <NowRunningPanel
        tasks={[baseTask]}
        cancellingTaskId="task-1"
        onStop={jest.fn()}
      />
    );

    const stopButton = screen.getByRole("button", { name: "Stopping..." });
    expect(stopButton).toBeDisabled();
  });
});
