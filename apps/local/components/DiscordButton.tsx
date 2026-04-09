"use client";

export function DiscordButton() {
  return (
    <a
      href="https://discord.gg/G9afUYKKY3"
      target="_blank"
      rel="noopener noreferrer"
      className="fixed bottom-4 left-4 z-50 flex items-center gap-2 px-3 py-2 rounded-lg text-white text-sm font-medium transition-colors shadow-lg"
      style={{ backgroundColor: '#5865F2' }}
      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#4752C4')}
      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#5865F2')}
    >
      <svg width="16" height="16" viewBox="0 0 71 55" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
        <path d="M60.1 4.9A58.5 58.5 0 0045.4.2a.2.2 0 00-.2.1 40.8 40.8 0 00-1.8 3.7 54 54 0 00-16.2 0A37.4 37.4 0 0025.4.3a.2.2 0 00-.2-.1A58.4 58.4 0 0010.5 4.9a.2.2 0 00-.1.1C1.5 18.7-.9 32.2.3 45.5v.1a58.8 58.8 0 0017.7 9a.2.2 0 00.3-.1 42 42 0 003.6-5.9.2.2 0 00-.1-.3 38.8 38.8 0 01-5.5-2.6.2.2 0 01 0-.4l1.1-.9a.2.2 0 01.2 0 42 42 0 0035.6 0 .2.2 0 01.2 0l1.1.9a.2.2 0 010 .4 36.4 36.4 0 01-5.5 2.6.2.2 0 00-.1.3 47.2 47.2 0 003.6 5.9.2.2 0 00.3.1 58.6 58.6 0 0017.7-9v-.1c1.4-15.2-2.4-28.4-10-40.1a.2.2 0 00-.1-.1zM23.7 37.3c-3.5 0-6.3-3.2-6.3-7s2.8-7 6.3-7 6.4 3.2 6.3 7-2.8 7-6.3 7zm23.3 0c-3.5 0-6.3-3.2-6.3-7s2.8-7 6.3-7 6.4 3.2 6.3 7-2.8 7-6.3 7z"/>
      </svg>
      Join Discord
    </a>
  );
}
