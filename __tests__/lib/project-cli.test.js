const { collectProjectFlags, buildProjectBody, createProject } = require('../../lib/project-cli');

describe('project-cli helpers', () => {
  describe('collectProjectFlags', () => {
    test('parses supported flags and normals metadata/repos', () => {
      const flags = collectProjectFlags([
        '--name', 'My Project',
        '--slug', 'my-project',
        '--description', 'Agent work',
        '--ci', 'CI pipeline',
        '--metadata', 'framework=react',
        '--repo', '{"name":"web","path":"/code/web"}',
      ]);

      expect(flags).toEqual({
        name: 'My Project',
        slug: 'my-project',
        description: 'Agent work',
        ci_cd_info: 'CI pipeline',
        metadata: ['framework=react'],
        repos: [{ name: 'web', path: '/code/web' }],
        workflow_id: null,
      });
    });

    test('throws when unknown option provided', () => {
      expect(() => collectProjectFlags(['--unknown', 'value'])).toThrow('Unknown option for project command: --unknown');
    });

    test('throws when metadata value missing', () => {
      expect(() => collectProjectFlags(['--metadata'])).toThrow('Missing value for --metadata');
    });
  });

  describe('buildProjectBody', () => {
    test('builds trimmed payload and skips empty strings', () => {
      const body = buildProjectBody({
        name: ' Project ',
        slug: ' project-slug ',
        description: ' desc ',
        ci_cd_info: ' ci ',
        metadata: ['stack=next', 'ci=github'],
        repos: [{ name: 'api' }],
      });

      expect(body).toEqual({
        name: 'Project',
        slug: 'project-slug',
        description: 'desc',
        ci_cd_info: 'ci',
        metadata: { stack: 'next', ci: 'github' },
        repos: [{ name: 'api' }],
      });
    });

    test('omits fields that are falsy after trimming', () => {
      const body = buildProjectBody({
        name: '  ',
        slug: '',
        description: null,
        ci_cd_info: '   ',
        metadata: [],
        repos: [],
      });

      expect(body).toEqual({});
    });
  });

  describe('createProject', () => {
    test('requires a name', async () => {
      await expect(createProject({ name: '  ' }, jest.fn())).rejects.toThrow('Project name is required (--name)');
    });

    test('requires cloudRequest function', async () => {
      await expect(createProject({ name: 'Test' }, null)).rejects.toThrow('cloudRequest function is required to create a project');
    });

    test('delegates to cloudRequest with POST payload', async () => {
      const cloudRequestMock = jest.fn().mockResolvedValue({ project: { id: '123', name: 'Test' } });
      const result = await createProject({
        name: 'Test',
        slug: 'test-slug',
        description: 'desc',
        ci_cd_info: 'ci info',
        metadata: ['foo=bar'],
        repos: [{ name: 'repo', path: '/code/repo' }],
      }, cloudRequestMock);

      expect(cloudRequestMock).toHaveBeenCalledWith('POST', '/api/projects', {
        name: 'Test',
        slug: 'test-slug',
        description: 'desc',
        ci_cd_info: 'ci info',
        metadata: { foo: 'bar' },
        repos: [{ name: 'repo', path: '/code/repo' }],
      });
      expect(result).toEqual({ project: { id: '123', name: 'Test' } });
    });
  });
});
