function evaluate(expression, context = {}) {
  const evaluator = new Function(
    'ctx',
    `with (ctx) { return (${expression}); }`,
  );
  return evaluator(context);
}

module.exports = {
  evaluate,
};
