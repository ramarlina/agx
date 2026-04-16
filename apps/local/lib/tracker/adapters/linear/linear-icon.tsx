// Client-safe LinearIcon component — no server-only imports.
export function LinearIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 100 100"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M2.4 62.4C1.2 58.2.4 53.8.4 49.2.4 38 5 28 12.4 20.8l4.8 4.8C11.2 31.6 7.2 39.8 7.2 49.2c0 3.8.6 7.4 1.6 10.8L2.4 62.4zM20.8 12.4C28 5 38 .4 49.2.4c4.6 0 9 .8 13.2 2l-2.4 6.4C56.8 7.8 53.2 7.2 49.2 7.2c-9.4 0-17.6 4-23.6 10L20.8 12.4zM87.6 20.8C95 28 99.6 38 99.6 49.2c0 4.6-.8 9-2 13.2l-6.4-2.4c1-3.4 1.6-7 1.6-10.8 0-9.4-4-17.6-10-23.6l4.8-4.8zM37.6 62.4C34 58.8 31.6 54 31.6 49.2c0-9.6 7.8-17.6 17.6-17.6 4.8 0 9.2 2 12.8 5.2l-4.4 5.2C55.2 39.8 52.2 38 49.2 38c-6.2 0-11.2 5-11.2 11.2 0 3 1.2 5.8 3 8l-3.4 5.2z" />
    </svg>
  );
}
