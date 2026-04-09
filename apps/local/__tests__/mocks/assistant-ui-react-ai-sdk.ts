import { useState } from 'react';

interface MockUiTextPart {
  type: 'text';
  text: string;
}

interface MockUiMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  parts: MockUiTextPart[];
}

interface MockRuntime {
  messages: MockUiMessage[];
  composerText: string;
  setComposerText: (value: string) => void;
  sendMessage: (value: string) => void;
}

export class AssistantChatTransport {
  options: unknown;
  constructor(options?: unknown) {
    this.options = options;
  }

  setRuntime(_runtime: unknown) {
    // noop for tests
  }
}

export function useChatRuntime(options?: { messages?: MockUiMessage[] }): MockRuntime {
  const [messages, setMessages] = useState<MockUiMessage[]>(options?.messages ?? []);
  const [composerText, setComposerText] = useState('');

  const sendMessage = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;

    setMessages((previous) => [
      ...previous,
      {
        id: `mock-user-${Date.now()}`,
        role: 'user',
        parts: [{ type: 'text', text: trimmed }],
      },
      {
        id: `mock-assistant-${Date.now()}`,
        role: 'assistant',
        parts: [{ type: 'text', text: `Mock assistant response for: ${trimmed}` }],
      },
    ]);

    setComposerText('');
  };

  return {
    messages,
    composerText,
    setComposerText,
    sendMessage,
  };
}
