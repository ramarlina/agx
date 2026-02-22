# Thread sidebar audit

## 1. Component surface
- The only UI source that resembles a sidebar today is `ui/components/thread-list.tsx`. Every export (`ThreadList`, `ThreadListToolbar`, `ThreadListItems`, `ThreadPersistenceControls`) currently just returns `null` but carries thorough inline notes about layout, aria handling, and how it should share the `ThreadAdapter` across toolbar/body/footer sections.
- `ThreadList` expects props for: `adapter` (a `ThreadAdapter` implementation), `workspaceName`, `threads` (an array of `ThreadSummary`), `selectedThreadId`, `storageStatus` (`ThreadStorageStatus`), `onThreadSelect`, and optionally `onThreadCreate`. This is the primary entry point where future sidebar markup will live.
- `ThreadListToolbar` will surface the workspace label, save/restore buttons, and any overflow menu that also uses the `adapter` for persistence actions. `ThreadListItems` is responsible for rendering the scrollable list, each item announcing selection state and hooking `onThreadSelect`. `ThreadPersistenceControls` is the footer that should render loaders/toasts and buttons wired to `adapter.saveThread`, `adapter.loadThread`, `adapter.listThreads`, and `adapter.deleteThread` while mirroring `storageStatus`.

## 2. Props & data flow
- `ThreadSummary` (within the same file) defines the data shape: `{ id, title, snippet?, updatedAt?, metadata? }`. `updatedAt` is the primary hook for sorting (TODO: the component must present threads in descending `updatedAt`).
- Thread data enters the sidebar through the `threads` prop; selection is tracked via `selectedThreadId` and `onThreadSelect`, which ultimately drives which thread's messages are shown in the main composer area (not implemented yet but implied).
- `storageStatus` prop is the coordination point for loading/saving states. The `ThreadPersistenceControls` export documents how it should use flags like `isSaving`, `isLoading`, `isListing`, `isDeleting`, plus `ariaLiveText`/`focusTarget` to keep shared accessibility expectations.
- The inline comments repeatedly note that every control (toolbar, list, footer) should share the `ThreadAdapter` rather than re-fetching data, so future wiring will likely use a context/provider that hands the adapter and status slice down to these props.

## 3. Persistence & service sources
- The only concrete persistence abstraction today is in `lib/storage/thread-adapter.ts` plus its `LocalThreadAdapter` implementation (`lib/storage/local-thread-adapter.ts`). The adapter exposes `saveThread`, `loadThread`, `listThreads`, and `deleteThread`, which is the surface the sidebar will call when implementing create/switch/delete behavior.
- `ui/state/thread-storage.ts` defines `ThreadStorageStatus` and `ThreadStorageSlice`, along with dispatcher signatures. This slice tracks granular flags (`isSaving`, `isLoading`, etc.), error strings, and focuses announcements so the sidebar can read/write accessible text without duplicating logic.
- No `src/services/threadService.ts` exists yet; the repo currently relies on the adapter interface directly. A future `threadService` will likely wrap `LocalThreadAdapter` (or another adapter) to centralize fetching/sorting logic, but as of today the only permanent service is the adapter/adapter state described above.

## 4. Styling & empty state hooks
- There is no `src/styles/threadSidebar.css`, nor any CSS file referencing a `threadSidebar` class. The component is purely conceptual today, so no specific styling hooks have been applied yet. The main Next/React app (outside `ui/`) currently relies on Tailwind utility classes in `components/chat`, so the new sidebar will need its own stylesheet or utility module once layout is implemented.
- Because the component returns `null`, there is no rendered DOM, no empty-state copy, and no `Start a new conversation` prompt yet. Future implementation must provide this kind of fallback when `threads` is empty.

## 5. Display quirks & gaps that matter for create/switch/delete
- The only place that acknowledges thread persistence is the placeholder `ThreadPersistenceControls` comments; there are no buttons in the code, so users currently cannot create, switch, or delete threads.
- The inline notes mention `onThreadCreate`, but no UI is wired to invoke it. Any action hooking to thread creation/deletion must integrate with the `ThreadAdapter` and update `storageStatus` so the status banner, error card, and fallback flows (per `ui/docs/thread-persistence-ux.md`) can respond consistently.
- With nothing rendered, there is no existing sort order enforcement—`threads` must be sorted by `updatedAt` before being passed into the sidebar, or the component must sort them internally.
- The persistence UX doc (`ui/docs/thread-persistence-ux.md`) already spells out loading/success/error/fallback states, so future toolbar/list/footer markup should reuse its guidance for accessible live regions and responsive layout.

## 6. Files to update for the upcoming features
1. `ui/components/thread-list.tsx` – implement the actual toolbar/list/footer markup, including `Start a new conversation` empty state, thread sorting, selection handling, and create/delete buttons wired to the adapter via `onThreadCreate`, `onThreadSelect`, etc.
2. `ui/state/thread-storage.ts` (and any context/provider) – ensure the sidebar receives a live status slice and dispatchers so the buttons can toggle loaders and error states just as the doc prescribes.
3. `lib/storage/local-thread-adapter.ts` (or a new `threadService` wrapper) – provide the sorting/listing logic that returns thread summaries ordered by `updatedAt`, and expose create/delete helpers so the UI has a single source of truth for thread metadata.
4. `src/styles/threadSidebar.css` – add layout rules for the sidebar, toolbar, persistence controls, and the `Start a new conversation` card.
5. `src/services/threadService.ts` – once implemented, this service should coordinate between the storage adapter and UI, allowing the sidebar to call `createThread`, `switchThread`, and `deleteThread` while the service keeps `ThreadSummary` data fresh.
