import express from 'express';
import { v4 as uuidv4 } from 'uuid';

const app = express();
const PORT = process.env.PORT || 3000;

// In-memory storage
const todos = new Map();

// Middleware
app.use(express.json());

// Custom error class for API errors
class ApiError extends Error {
  constructor(statusCode, message, details = null) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
    this.isOperational = true;
  }
}

// Validation helpers
function validateTodoInput(body, isUpdate = false) {
  const errors = [];

  if (!isUpdate && !body.title) {
    errors.push({ field: 'title', message: 'Title is required' });
  }

  if (body.title !== undefined) {
    if (typeof body.title !== 'string') {
      errors.push({ field: 'title', message: 'Title must be a string' });
    } else if (body.title.trim().length === 0) {
      errors.push({ field: 'title', message: 'Title cannot be empty' });
    } else if (body.title.length > 200) {
      errors.push({ field: 'title', message: 'Title must be 200 characters or less' });
    }
  }

  if (body.completed !== undefined && typeof body.completed !== 'boolean') {
    errors.push({ field: 'completed', message: 'Completed must be a boolean' });
  }

  if (body.priority !== undefined) {
    const validPriorities = ['low', 'medium', 'high'];
    if (!validPriorities.includes(body.priority)) {
      errors.push({ field: 'priority', message: `Priority must be one of: ${validPriorities.join(', ')}` });
    }
  }

  return errors;
}

function validateUUID(id) {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(id);
}

// Async handler wrapper
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// Routes

// GET /todos - List all todos
app.get('/todos', asyncHandler(async (req, res) => {
  const { completed, priority } = req.query;
  let result = Array.from(todos.values());

  // Filter by completed status
  if (completed !== undefined) {
    const isCompleted = completed === 'true';
    result = result.filter(t => t.completed === isCompleted);
  }

  // Filter by priority
  if (priority) {
    if (!['low', 'medium', 'high'].includes(priority)) {
      throw new ApiError(400, 'Invalid priority filter', {
        field: 'priority',
        allowed: ['low', 'medium', 'high']
      });
    }
    result = result.filter(t => t.priority === priority);
  }

  // Sort by createdAt descending
  result.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  res.json({
    success: true,
    count: result.length,
    data: result
  });
}));

// GET /todos/:id - Get single todo
app.get('/todos/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!validateUUID(id)) {
    throw new ApiError(400, 'Invalid todo ID format');
  }

  const todo = todos.get(id);
  if (!todo) {
    throw new ApiError(404, 'Todo not found', { id });
  }

  res.json({
    success: true,
    data: todo
  });
}));

// POST /todos - Create new todo
app.post('/todos', asyncHandler(async (req, res) => {
  const validationErrors = validateTodoInput(req.body);
  if (validationErrors.length > 0) {
    throw new ApiError(400, 'Validation failed', { errors: validationErrors });
  }

  const todo = {
    id: uuidv4(),
    title: req.body.title.trim(),
    completed: req.body.completed ?? false,
    priority: req.body.priority ?? 'medium',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  todos.set(todo.id, todo);

  res.status(201).json({
    success: true,
    message: 'Todo created successfully',
    data: todo
  });
}));

// PUT /todos/:id - Update todo
app.put('/todos/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!validateUUID(id)) {
    throw new ApiError(400, 'Invalid todo ID format');
  }

  const todo = todos.get(id);
  if (!todo) {
    throw new ApiError(404, 'Todo not found', { id });
  }

  const validationErrors = validateTodoInput(req.body, true);
  if (validationErrors.length > 0) {
    throw new ApiError(400, 'Validation failed', { errors: validationErrors });
  }

  // Update fields
  if (req.body.title !== undefined) {
    todo.title = req.body.title.trim();
  }
  if (req.body.completed !== undefined) {
    todo.completed = req.body.completed;
  }
  if (req.body.priority !== undefined) {
    todo.priority = req.body.priority;
  }
  todo.updatedAt = new Date().toISOString();

  todos.set(id, todo);

  res.json({
    success: true,
    message: 'Todo updated successfully',
    data: todo
  });
}));

// PATCH /todos/:id/toggle - Toggle completed status
app.patch('/todos/:id/toggle', asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!validateUUID(id)) {
    throw new ApiError(400, 'Invalid todo ID format');
  }

  const todo = todos.get(id);
  if (!todo) {
    throw new ApiError(404, 'Todo not found', { id });
  }

  todo.completed = !todo.completed;
  todo.updatedAt = new Date().toISOString();

  todos.set(id, todo);

  res.json({
    success: true,
    message: `Todo marked as ${todo.completed ? 'completed' : 'incomplete'}`,
    data: todo
  });
}));

// DELETE /todos/:id - Delete todo
app.delete('/todos/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!validateUUID(id)) {
    throw new ApiError(400, 'Invalid todo ID format');
  }

  if (!todos.has(id)) {
    throw new ApiError(404, 'Todo not found', { id });
  }

  todos.delete(id);

  res.json({
    success: true,
    message: 'Todo deleted successfully'
  });
}));

// DELETE /todos - Delete all completed todos
app.delete('/todos', asyncHandler(async (req, res) => {
  const { completed } = req.query;

  if (completed !== 'true') {
    throw new ApiError(400, 'Must specify ?completed=true to delete completed todos');
  }

  let deletedCount = 0;
  for (const [id, todo] of todos) {
    if (todo.completed) {
      todos.delete(id);
      deletedCount++;
    }
  }

  res.json({
    success: true,
    message: `Deleted ${deletedCount} completed todo(s)`,
    deletedCount
  });
}));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 404 handler for unknown routes
app.use((req, res, next) => {
  throw new ApiError(404, `Route ${req.method} ${req.path} not found`);
});

// Global error handler
app.use((err, req, res, next) => {
  // Log error for debugging
  if (process.env.NODE_ENV !== 'production') {
    console.error(`[${new Date().toISOString()}] Error:`, err);
  }

  // Handle JSON parse errors
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({
      success: false,
      error: 'Invalid JSON in request body',
      message: err.message
    });
  }

  // Handle our custom API errors
  if (err instanceof ApiError) {
    return res.status(err.statusCode).json({
      success: false,
      error: err.message,
      ...(err.details && { details: err.details })
    });
  }

  // Handle unexpected errors
  const statusCode = err.statusCode || 500;
  res.status(statusCode).json({
    success: false,
    error: statusCode === 500 ? 'Internal server error' : err.message,
    ...(process.env.NODE_ENV !== 'production' && { stack: err.stack })
  });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  process.exit(0);
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Start server
app.listen(PORT, () => {
  console.log(`Todo API server running on http://localhost:${PORT}`);
  console.log('Available endpoints:');
  console.log('  GET    /health              - Health check');
  console.log('  GET    /todos               - List all todos');
  console.log('  GET    /todos/:id           - Get single todo');
  console.log('  POST   /todos               - Create todo');
  console.log('  PUT    /todos/:id           - Update todo');
  console.log('  PATCH  /todos/:id/toggle    - Toggle completed');
  console.log('  DELETE /todos/:id           - Delete todo');
  console.log('  DELETE /todos?completed=true - Delete all completed');
});
