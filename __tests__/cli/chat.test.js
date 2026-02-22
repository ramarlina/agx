const { ChatSession } = require('../../lib/cli/chat');
const { createCloudClient } = require('../../lib/cloud/client');
const { loadConfig } = require('../../lib/cli/configStore');
const { detectProviders } = require('../../lib/cli/providers');

jest.mock('../../lib/cloud/client');
jest.mock('../../lib/cli/configStore');
jest.mock('../../lib/cli/providers');
jest.mock('execa');
jest.mock('readline');

describe('ChatSession', () => {
  let session;
  const mockCloudClient = {
    request: jest.fn(),
  };

  beforeEach(() => {
    createCloudClient.mockReturnValue(mockCloudClient);
    loadConfig.mockReturnValue({ defaultProvider: 'claude' });
    detectProviders.mockReturnValue({ claude: true });
    session = new ChatSession({ provider: 'claude' });
  });

  test('initializes correctly', async () => {
    mockCloudClient.request.mockResolvedValueOnce({ task: { id: 'test-task-id' } });
    await session.init();
    expect(session.taskId).toBe('test-task-id');
    expect(mockCloudClient.request).toHaveBeenCalledWith('POST', '/api/tasks', expect.any(Object));
  });
});
