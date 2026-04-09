import React, {
  createContext,
  forwardRef,
  useContext,
  type FormEvent,
  type ReactNode,
} from 'react';

type MockMessage = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  parts?: Array<{ type: string; text?: string }>;
};

type MockRuntime = {
  messages?: MockMessage[];
  composerText?: string;
  isDisabled?: boolean;
  isRunning?: boolean;
  setComposerText?: (value: string) => void;
  sendMessage?: (value: string) => void;
  cancel?: () => void;
  cancelRun?: () => void;
};

const RuntimeContext = createContext<MockRuntime | null>(null);
const MessageContext = createContext<MockMessage | null>(null);

export function AssistantRuntimeProvider({
  runtime,
  children,
}: {
  runtime: MockRuntime;
  children: ReactNode;
}) {
  return <RuntimeContext.Provider value={runtime}>{children}</RuntimeContext.Provider>;
}

const ComposerRoot = ({
  children,
  onSubmit,
  ...props
}: React.FormHTMLAttributes<HTMLFormElement>) => {
  const runtime = useContext(RuntimeContext);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = (runtime?.composerText ?? '').trim();
    if (text) {
      runtime?.sendMessage?.(text);
    }
    if (onSubmit) {
      onSubmit(event);
    }
  };

  return (
    <form {...props} onSubmit={handleSubmit}>
      {children}
    </form>
  );
};

const ComposerInput = forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement> & { submitMode?: string }
>(function ComposerInput({ submitMode: _submitMode, onChange, ...props }, ref) {
  const runtime = useContext(RuntimeContext);

  return (
    <textarea
      {...props}
      ref={ref}
      value={runtime?.composerText ?? ''}
      onChange={(event) => {
        runtime?.setComposerText?.(event.target.value);
        onChange?.(event);
      }}
    />
  );
});

const ComposerSend = ({
  children,
  disabled,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) => {
  const runtime = useContext(RuntimeContext);
  const isDisabled = disabled || Boolean(runtime?.isRunning) || !(runtime?.composerText ?? '').trim();
  return (
    <button {...props} type="submit" disabled={isDisabled}>
      {children}
    </button>
  );
};

const ComposerCancel = ({
  children,
  disabled,
  onClick,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) => {
  const runtime = useContext(RuntimeContext);
  const canCancel = Boolean(runtime?.isRunning && (runtime?.cancel || runtime?.cancelRun));
  const isDisabled = disabled || !canCancel;
  return (
    <button
      {...props}
      type="button"
      disabled={isDisabled}
      onClick={(event) => {
        if (!isDisabled) {
          runtime?.cancelRun?.();
          runtime?.cancel?.();
        }
        onClick?.(event);
      }}
    >
      {children}
    </button>
  );
};

const ThreadRoot = ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div {...props}>{children}</div>
);

const ThreadViewport = ({
  children,
  turnAnchor: _turnAnchor,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { turnAnchor?: string }) => (
  <div {...props}>{children}</div>
);

const ThreadEmpty = ({ children }: { children: ReactNode }) => {
  const runtime = useContext(RuntimeContext);
  const messages = runtime?.messages ?? [];
  if (messages.length > 0) return null;
  return <>{children}</>;
};

const ThreadMessages = ({
  components,
}: {
  components: {
    Message?: React.ComponentType;
    UserMessage?: React.ComponentType;
    AssistantMessage?: React.ComponentType;
    SystemMessage?: React.ComponentType;
  };
}) => {
  const runtime = useContext(RuntimeContext);
  const messages = runtime?.messages ?? [];

  return (
    <>
      {messages.map((message, index) => {
        const Component =
          message.role === 'user'
            ? components.UserMessage || components.Message
            : message.role === 'assistant'
            ? components.AssistantMessage || components.Message
            : components.SystemMessage || components.Message;

        if (!Component) return null;

        return (
          <MessageContext.Provider key={message.id || `mock-msg-${index}`} value={message}>
            <Component />
          </MessageContext.Provider>
        );
      })}
    </>
  );
};

const ThreadIf = ({
  children,
  empty,
  running,
  disabled,
}: {
  children: ReactNode;
  empty?: boolean;
  running?: boolean;
  disabled?: boolean;
}) => {
  const runtime = useContext(RuntimeContext);
  const messages = runtime?.messages ?? [];
  const isRunning = Boolean(runtime?.isRunning);
  const isDisabled = Boolean(runtime?.isDisabled);

  if (typeof empty === 'boolean' && empty !== (messages.length === 0)) return null;
  if (typeof running === 'boolean' && running !== isRunning) return null;
  if (typeof disabled === 'boolean' && disabled !== isDisabled) return null;

  return <>{children}</>;
};

const MessageRoot = ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div {...props}>{children}</div>
);

const MessageParts = ({
  components,
}: {
  components?: {
    Text?: React.ComponentType<{ text: string }>;
  };
}) => {
  const message = useContext(MessageContext);
  const text = (message?.parts ?? [])
    .filter((part) => part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text as string)
    .join('\n');

  const TextComponent = components?.Text;
  if (TextComponent) {
    return <TextComponent text={text} />;
  }

  return <p>{text}</p>;
};

export const ComposerPrimitive = {
  Root: ComposerRoot,
  Input: ComposerInput,
  Send: ComposerSend,
  Cancel: ComposerCancel,
};

export const ThreadPrimitive = {
  Root: ThreadRoot,
  Viewport: ThreadViewport,
  Empty: ThreadEmpty,
  If: ThreadIf,
  Messages: ThreadMessages,
};

export const MessagePrimitive = {
  Root: MessageRoot,
  Parts: MessageParts,
};
