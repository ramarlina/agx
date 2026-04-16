import { logger, flush } from "../../lib/logger";

describe("logger", () => {
  it("exports error, warn, info methods", () => {
    expect(typeof logger.error).toBe("function");
    expect(typeof logger.warn).toBe("function");
    expect(typeof logger.info).toBe("function");
  });

  it("exports a flush function", () => {
    expect(typeof flush).toBe("function");
  });

  it("does not throw when called", () => {
    expect(() => logger.error("test error")).not.toThrow();
  });

  it("formatError extracts Error fields", () => {
    const err = new Error("boom");
    err.name = "TestError";
    const formatted = logger.formatError(err);
    expect(formatted).toEqual(
      expect.objectContaining({ name: "TestError", message: "boom" })
    );
    expect(formatted.stack).toBeDefined();
  });

  it("formatError handles non-Error values", () => {
    expect(logger.formatError("string error")).toEqual({ message: "string error" });
    expect(logger.formatError(42)).toEqual({ message: "42" });
  });
});
