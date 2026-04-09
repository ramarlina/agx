import { evaluate } from 'cel-js';

export class ConditionEvaluationError extends Error {
  readonly expression: string;

  constructor(expression: string, message: string, cause?: unknown) {
    super(message);
    this.name = 'ConditionEvaluationError';
    this.expression = expression;
    if (cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = cause;
    }
  }
}

export function evaluateCondition(
  expression: string,
  ctx: Record<string, unknown>,
): boolean {
  try {
    const result = evaluate(expression, ctx);
    if (typeof result !== 'boolean') {
      throw new ConditionEvaluationError(
        expression,
        'Condition expression must evaluate to a boolean value.',
      );
    }
    return result;
  } catch (error) {
    if (error instanceof ConditionEvaluationError) {
      throw error;
    }

    const message = error instanceof Error ? error.message : String(error);
    throw new ConditionEvaluationError(
      expression,
      `Failed to evaluate condition expression: ${message}`,
      error,
    );
  }
}
