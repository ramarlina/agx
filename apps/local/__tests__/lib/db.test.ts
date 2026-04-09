/**
 * Tests for lib/db.ts - focusing on pure functions (no database mocking required)
 */

import {
  parseFrontmatter,
  extractTitle,
  defaultStagePrompts,
  TaskStatus,
  TaskStage,
  LearningScope,
} from '@/lib/db';

describe('Frontmatter Parsing', () => {
  test('parseFrontmatter extracts YAML frontmatter', () => {
    const markdown = `---
id: task-123
status: in_progress
stage: coding
priority: 1
---

# Task Title

Task description here.`;

    const { frontmatter, body } = parseFrontmatter(markdown);
    
    expect(frontmatter.id).toBe('task-123');
    expect(frontmatter.status).toBe('in_progress');
    expect(frontmatter.stage).toBe('coding');
    expect(frontmatter.priority).toBe(1);
    expect(body).toContain('# Task Title');
    expect(body).toContain('Task description here.');
  });

  test('parseFrontmatter handles missing frontmatter', () => {
    const markdown = '# Just a title\n\nNo frontmatter here.';
    const { frontmatter, body } = parseFrontmatter(markdown);
    
    expect(frontmatter).toEqual({});
    expect(body).toBe(markdown);
  });

  test('parseFrontmatter parses boolean values', () => {
    const markdown = `---
active: true
disabled: false
---
content`;

    const { frontmatter } = parseFrontmatter(markdown);
    
    expect(frontmatter.active).toBe(true);
    expect(frontmatter.disabled).toBe(false);
  });

  test('parseFrontmatter parses numeric values', () => {
    const markdown = `---
priority: 42
count: 0
---
content`;

    const { frontmatter } = parseFrontmatter(markdown);
    
    expect(frontmatter.priority).toBe(42);
    expect(frontmatter.count).toBe(0);
  });

  test('parseFrontmatter preserves string values with colons', () => {
    const markdown = `---
url: https://example.com:8080
---
content`;

    const { frontmatter } = parseFrontmatter(markdown);
    
    expect(frontmatter.url).toBe('https://example.com:8080');
  });

  test('parseFrontmatter handles empty frontmatter', () => {
    const markdown = `---
---
content`;

    const { frontmatter, body } = parseFrontmatter(markdown);
    
    expect(frontmatter).toEqual({});
    // Body includes content after closing ---
    expect(body).toContain('content');
  });

  test('parseFrontmatter handles multiple colons in value', () => {
    const markdown = `---
message: Hello: World: Test
time: 12:30:45
---
body`;

    const { frontmatter } = parseFrontmatter(markdown);
    
    expect(frontmatter.message).toBe('Hello: World: Test');
    expect(frontmatter.time).toBe('12:30:45');
  });

  test('parseFrontmatter handles frontmatter with special characters', () => {
    const markdown = `---
title: Task with "quotes" and 'apostrophes'
path: /some/path/here
---
body`;

    const { frontmatter } = parseFrontmatter(markdown);
    
    expect(frontmatter.title).toBe('Task with "quotes" and \'apostrophes\'');
    expect(frontmatter.path).toBe('/some/path/here');
  });
});

describe('Extract Title', () => {
  test('extractTitle finds H1 heading', () => {
    const markdown = `---
id: task-123
---

# Build OAuth Integration

Description here.`;

    expect(extractTitle(markdown)).toBe('Build OAuth Integration');
  });

  test('extractTitle returns undefined for no heading', () => {
    const markdown = 'Just some text without a heading.';
    expect(extractTitle(markdown)).toBeUndefined();
  });

  test('extractTitle extracts first H1 only', () => {
    const markdown = `# First Heading

# Second Heading`;

    expect(extractTitle(markdown)).toBe('First Heading');
  });

  test('extractTitle ignores H2 and lower', () => {
    const markdown = `## This is H2
### This is H3`;

    expect(extractTitle(markdown)).toBeUndefined();
  });

  test('extractTitle works without frontmatter', () => {
    const markdown = '# Simple Title\n\nContent here.';
    expect(extractTitle(markdown)).toBe('Simple Title');
  });

  test('extractTitle handles title with special characters', () => {
    const markdown = '# Build OAuth (v2.0) - Final Version!\n\nContent';
    expect(extractTitle(markdown)).toBe('Build OAuth (v2.0) - Final Version!');
  });
});

describe('Default Stage Prompts', () => {
  const expectedStages: TaskStage[] = ['INTAKE', 'PROGRESS', 'DONE'];

  test('defaultStagePrompts includes all 3 stages', () => {
    expect(Object.keys(defaultStagePrompts)).toHaveLength(3);
    expectedStages.forEach(stage => {
      expect((defaultStagePrompts as any)[stage]).toBeDefined();
    });
  });

  test('each stage has prompt and outputs', () => {
    expectedStages.forEach(stage => {
      expect((defaultStagePrompts as any)[stage]).toHaveProperty('prompt');
      expect((defaultStagePrompts as any)[stage]).toHaveProperty('outputs');
      expect(typeof (defaultStagePrompts as any)[stage].prompt).toBe('string');
      expect(Array.isArray((defaultStagePrompts as any)[stage].outputs)).toBe(true);
    });
  });

  test('DONE stage has empty outputs', () => {
    expect((defaultStagePrompts as any).DONE.outputs).toHaveLength(0);
  });

  test('INTAKE comes before PROGRESS', () => {
    const keys = Object.keys(defaultStagePrompts);
    const intakeIndex = keys.indexOf('INTAKE');
    const progressIndex = keys.indexOf('PROGRESS');
    expect(progressIndex).toBe(intakeIndex + 1);
  });

  test('all prompts are non-empty strings', () => {
    expectedStages.forEach(stage => {
      expect((defaultStagePrompts as any)[stage].prompt.length).toBeGreaterThan(0);
    });
  });

  test('DONE comes after PROGRESS', () => {
    const keys = Object.keys(defaultStagePrompts);
    const progressIndex = keys.indexOf('PROGRESS');
    const doneIndex = keys.indexOf('DONE');
    expect(doneIndex).toBe(progressIndex + 1);
  });
});

describe('Type Definitions', () => {
  test('TaskStatus type includes all valid statuses', () => {
    const statuses: TaskStatus[] = ['queued', 'in_progress', 'blocked', 'completed', 'failed'];
    expect(statuses).toHaveLength(5);
  });

  test('TaskStage type includes the simplified SDLC stages', () => {
    const stages: TaskStage[] = ['INTAKE', 'PROGRESS', 'DONE'];
    expect(stages).toHaveLength(3);
    expect(stages).toContain('PROGRESS');
  });

  test('LearningScope type includes all scopes', () => {
    const scopes: LearningScope[] = ['task', 'project', 'global'];
    expect(scopes).toHaveLength(3);
  });

  test('TaskStage stages are in correct order', () => {
    const expectedOrder: TaskStage[] = ['INTAKE', 'PROGRESS', 'DONE'];
    const actualOrder = Object.keys(defaultStagePrompts) as TaskStage[];
    expect(actualOrder).toEqual(expectedOrder);
  });
});

describe('Frontmatter Edge Cases', () => {
  test('handles Windows line endings', () => {
    const markdown = `---\r\nstage: coding\r\nstatus: queued\r\n---\r\n# Title\r\nBody`;
    const { frontmatter, body } = parseFrontmatter(markdown);
    // Should still work (may have some line ending differences)
    expect(body).toContain('Title');
  });

  test('handles consecutive dashes in content', () => {
    const markdown = `---
title: Test
---

# Title

---
This is a horizontal rule above.`;

    const { frontmatter, body } = parseFrontmatter(markdown);
    expect(frontmatter.title).toBe('Test');
    expect(body).toContain('horizontal rule');
  });
});
