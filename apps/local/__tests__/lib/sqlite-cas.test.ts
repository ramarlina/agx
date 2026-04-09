import { SqlExpression, sqlExpr } from "@/lib/sqlite-query-adapter";

describe("SqlExpression", () => {
  test("sqlExpr creates SqlExpression instance", () => {
    const expr = sqlExpr("version + 1");
    expect(expr).toBeInstanceOf(SqlExpression);
    expect(expr.expr).toBe("version + 1");
  });
});
