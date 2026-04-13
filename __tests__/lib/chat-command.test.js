jest.mock('../../lib/config/cloudConfig', () => ({
  loadCloudConfigFile: jest.fn(() => ({ url: 'http://localhost:41741', hasSeenWelcome: true })),
  saveCloudConfigFile: jest.fn(),
}));

jest.mock('../../lib/cli/daemon', () => ({
  startDaemon: jest.fn(),
  stopBoard: jest.fn(async () => true),
}));

jest.mock('../../lib/commands/daemonBoard', () => ({
  openInBrowser: jest.fn(),
}));

const { maybeHandleChatCommand } = require('../../lib/commands/chat');
const { startDaemon, stopBoard } = require('../../lib/cli/daemon');
const { openInBrowser } = require('../../lib/commands/daemonBoard');

describe('maybeHandleChatCommand', () => {
  const c = {
    bold: '',
    cyan: '',
    dim: '',
    reset: '',
    yellow: '',
  };

  let logSpy;

  beforeEach(() => {
    jest.clearAllMocks();
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  test('warns and preserves existing start behavior for chat start', async () => {
    const ensureBoardRunning = jest.fn(async () => {});
    const setBoardEnsuredFalse = jest.fn();
    const probeBoardHealth = jest.fn(async () => true);
    const getBoardPort = jest.fn(() => 41741);

    const handled = await maybeHandleChatCommand({
      cmd: 'chat',
      args: ['chat', 'start'],
      ctx: { c, ensureBoardRunning, probeBoardHealth, getBoardPort, setBoardEnsuredFalse },
    });

    expect(handled).toBe(true);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('agx chat start'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('agx board start'));
    expect(setBoardEnsuredFalse).toHaveBeenCalled();
    expect(ensureBoardRunning).toHaveBeenCalled();
    expect(startDaemon).toHaveBeenCalledWith({ maxWorkers: 1 });
    expect(probeBoardHealth).toHaveBeenCalledWith(41741);
    expect(openInBrowser).not.toHaveBeenCalled();
  });

  test('warns and delegates chat stop to board stop', async () => {
    const handled = await maybeHandleChatCommand({
      cmd: 'chat',
      args: ['chat', 'stop'],
      ctx: { c },
    });

    expect(handled).toBe(true);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('agx chat stop'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('agx board stop'));
    expect(stopBoard).toHaveBeenCalled();
  });
});
