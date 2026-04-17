/**
 * @jest-environment jsdom
 */

import { renderHook, waitFor, act } from "@testing-library/react";
import { UI_POLL_UPDATE_CHECK_MS } from "@/lib/constants/timing";

const mockFetch = jest.fn();
global.fetch = mockFetch as typeof fetch;

jest.useFakeTimers();

import { useUpdateCheck } from "@/hooks/useUpdateCheck";

describe("useUpdateCheck", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("returns updateAvailable: false initially and true after fetch", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ updateAvailable: true, latestVersion: "2.0.0", currentVersion: "1.0.0" }),
    });

    const { result } = renderHook(() => useUpdateCheck());

    expect(result.current.updateAvailable).toBe(false);

    await waitFor(() => {
      expect(result.current.updateAvailable).toBe(true);
      expect(result.current.latestVersion).toBe("2.0.0");
    });
  });

  test("re-checks after polling interval", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ updateAvailable: false, latestVersion: "1.0.0", currentVersion: "1.0.0" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ updateAvailable: true, latestVersion: "2.0.0", currentVersion: "1.0.0" }),
      });

    const { result } = renderHook(() => useUpdateCheck());

    await waitFor(() => {
      expect(result.current.updateAvailable).toBe(false);
    });

    act(() => {
      jest.advanceTimersByTime(UI_POLL_UPDATE_CHECK_MS);
    });

    await waitFor(() => {
      expect(result.current.updateAvailable).toBe(true);
    });

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  test("stays false on fetch error", async () => {
    mockFetch.mockRejectedValue(new Error("network error"));

    const { result } = renderHook(() => useUpdateCheck());

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    expect(result.current.updateAvailable).toBe(false);
  });
});
