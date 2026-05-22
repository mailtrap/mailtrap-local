---
name: frontend-code-style
description: Use when writing or refactoring React + Tailwind v4 code in this repo. Covers component sizing, CSS deduplication via primitives + shared constants, design tokens via @theme, the "adjust state during render" pattern over setState-in-effect, directory layout (ui/message/sidebar/connections), and what NOT to extract.
---

# Frontend Code Style

## Overview

The frontend is React 19 + Tailwind v4 + Radix + Vite. Visual styling flows from `@theme` tokens in [index.css](frontend/src/index.css); structure flows from a feature-folder layout under `components/`. This skill codifies the conventions so new code lands consistent without inventing parallel systems.

**Core principle:** Extract when the same shape appears 2+ times OR when one file mixes 3+ unrelated concerns. Otherwise keep classNames inline next to the JSX they style.

## Directory Layout

```
src/
├── api/                       backend API clients
├── hooks/                     cross-cutting React hooks (incl. ConnectionProviders)
├── lib/                       pure helpers (formatters, styles constants, openInNewTab)
├── pages/                     top-level routes — MessageView, Sandbox
└── components/
    ├── ui/                    cross-cutting primitives (Button, IconButton,
    │                          Panel, Strip, EmptyCard, CategoryBadge, Toggle, icons)
    ├── message/               right-pane (MessageHeader, MessagePreview,
    │                          MessageTabs, HtmlSource, TechInfo, CodePane,
    │                          HtmlCheck/)
    ├── sidebar/               left-pane (Sidebar, SidebarToolbar, MessageList,
    │                          DeleteAllPrompt, ConnectionErrorBanner)
    ├── connections/           cloud/relay/webhook dialogs + dialogAtoms,
    │                          dialogStyles, lockedFields, SettingsMenu
    └── CodeSamples/           Sandbox empty-state code samples
```

**Rules:**
- A component used by only one feature belongs in that feature folder, not in `ui/`.
- `ui/` is for primitives reused by 2+ features.
- A component that hits 400+ lines or has clear inner sub-components becomes a folder with `index.tsx` (see `HtmlCheck/`).
- Tests sit next to the file they test (`Sidebar.test.tsx` next to `Sidebar.tsx`).

## CSS Conventions

### Tokens come first

Colors, fonts, accent levels live in `@theme` in `index.css`. Use them as Tailwind utilities (`bg-surface-base`, `text-fg-muted`, `text-warning`, `font-mono`). Never hard-code hex in components — add a `--color-<name>` token instead.

### Tailwind first, constants when reused

Single-use className: write inline.

Multi-line className constant: extract a local `const xCss = [...].join(' ')` next to where it's used. Use this when a className gets wide enough to wrap, or has stateful `data-[…]:` variants worth naming.

Cross-component reuse: extract a primitive component (preferred) or a shared constant in `lib/styles.ts` (when callers need to extend with their own utilities).

```tsx
// ❌ Don't: invent a one-off CSS constant for a single use
const wrapperCss = 'm-0'
return <section className={wrapperCss}>…</section>

// ✅ Do: inline when used once
return <section className="m-0">…</section>

// ✅ Do: name when wide + stateful
const row = [
  'group grid grid-cols-[1fr_auto] gap-x-3 px-4 py-3',
  'data-[read=true]:bg-surface-base',
  'data-[active=true]:!bg-accent data-[active=true]:hover:!bg-accent',
].join(' ')
```

### Variants via `data-*` attributes

Project convention is `data-[variant=primary]:bg-accent` style, not `clsx`/`cva`. See [Button.tsx](frontend/src/components/ui/Button.tsx), [IconButton.tsx](frontend/src/components/ui/IconButton.tsx), `dialogStyles.btn`. Match this pattern when adding new variant-driven components.

### Shared structural constants (`lib/styles.ts`)

Use a constant (not a component) when the same CSS fragment appears across different elements (`<input>`, `<select>`, `<textarea>`, `<pre>`) and callers extend with their own utilities:

- `inputBase` — border + bg + focus ring + placeholder color for form inputs.
- `codeBlockBase` — min-height + mono + rounded border for code panes.

Callers compose: ``className={`${inputBase} px-3 py-2 text-[13px]`}``.

### Primitive components for repeated visual patterns

Use a component when the wrapper element itself is the abstraction:

| Primitive | Purpose |
|---|---|
| `<Panel>` | Bordered card with raised bg (TechInfo sections, HtmlCheck issue cards, EmptyCard) |
| `<Strip variant shape>` | Dismissable success/error banner (`card` for MessageView, `banner` for Sidebar) |
| `<EmptyCard>` | Centered muted text inside a Panel (HtmlCheck empty states) |
| `<CategoryBadge size>` | Rounded category pill (header `lg`, list-row `sm` with active-state override) |
| `<Button variant size>` | Pill button outside dialogs; dialogs still use `dialogStyles.btn` for now |
| `<IconButton variant>` | 28×28 / 32×32 icon buttons (toolbar, header, device) |
| `<CodePane>` | `<pre>` with mono code styling + optional pop-out |
| `<TabRoot> <TabList> <Tab> <TabPanel>` | Radix Tabs wrapper that absorbs trigger/content styling |

## State Patterns

### "Adjust state during render" over setState-in-effect

When state needs to reset on a prop/data change, do it during render with a "last-seen" tracker, not in `useEffect`. This is the React docs' recommended pattern; it avoids the cascading-render warning the linter flags.

```tsx
// ❌ Don't
useEffect(() => {
  if (id) setMsg(null)
}, [id])

// ✅ Do
const [lastId, setLastId] = useState(id)
if (id !== lastId) {
  setLastId(id)
  setMsg(null)
}
```

Use `useEffect` only for true side effects: data fetching with cleanup, event listeners, subscriptions. setState inside an `.then()` / `.finally()` async callback is fine — the lint rule only flags the synchronous effect body.

### Reset state by remounting with `key`

When a child owns state that needs to reset on parent prop change, use `<Child key={id} />` instead of plumbing a reset callback. See `<MessageHeader key={msg.id} />` in MessageView.

### Hoist state only to the level that needs it

Per-issue `showAll` belongs inside `IssueCard`, not at the parent as `Record<number, boolean>`. Per-message `device` belongs inside `MessagePreview`, not at the page. If only one component reads the state, it should live there.

## Components

### Sizing

- Page components (under `pages/`): orchestration + data fetching + composition. Aim for < 350 lines.
- Feature components: < 250 lines. If a feature component grows internal sub-components, split into a folder.
- Primitives in `ui/`: tiny, single concern, < 100 lines.

### Extraction triggers

Split a component when any of these fire:
- File exceeds ~400 lines.
- Same JSX shape (an issue card, a banner) appears 2+ times across files.
- One component carries state that only one child uses.
- Three or more visually distinct "sections" share the file (header, list, footer all in one big return).

### What NOT to extract

- One-off className constants — keep them inline.
- A wrapper that only renames a `<div>` with no logic and no shared styling — inline the `<div>`.
- A helper that's a thin pass-through to a library API (e.g. a `TabRoot` that does nothing beyond `<Tabs.Root />`) — only worth it if siblings (Tab/TabPanel) need styling.
- Premature variant props for hypothetical future use cases.

## Dialog Conventions

The three connection dialogs (Cloud/Relay/Webhook) share infrastructure in `components/connections/`:

- `dialogStyles.ts` — class constants (overlay, content, field, fieldInput, btn).
- `dialogAtoms.tsx` — composite components (ConnectionDialogShell, DialogField, DialogActions, DialogButton, DialogStatusRow, DialogConfigBanner).
- `lockedFields.ts` — `lockedFields(state?.locked, defaults)` returns `{ isLocked, allLocked, anyLocked, inputClass, selectClass }`. Use it instead of re-implementing the `Record<K, boolean>` boilerplate per dialog.
- `LockedFieldHint.tsx` — the "pinned by config" caption under a locked input.
- `extractApiError(e)` from `api/client` for ALL caught errors (save, disconnect, test). Never `e instanceof Error ? e.message : String(e)`.

## Workflow for Large Refactors

1. Audit by size: `find src -name '*.tsx' | xargs wc -l | sort -rn | head -10`. Tackle the biggest first.
2. Read the giant before touching it. Identify natural seams (sub-components already declared inline, state used by only one branch).
3. Move CSS *with* the JSX it styles. Each extracted file carries its own className constants.
4. Tests query by role/text/title/placeholder, not className — extractions are safer than they look. Verify by reading the test file once before extracting.
5. Update `vi.mock()` and `vi.importActual()` paths when test files move — sed for `from '...'` won't catch them.
6. Run `npm test` and `npm run build` after each major extraction, not at the end.

## Anti-patterns

- ❌ `const xCss = '…'` for a className used once.
- ❌ Comments narrating what Tailwind utilities do (`// rounded card with border`). The class names already say that.
- ❌ Hard-coded hex (`#f5a524`, `#4d5a6a`) — add a `--color-<name>` token.
- ❌ `font-['SF_Mono',Menlo,Consolas,monospace]` inline — use `font-mono` (the `--font-mono` token is defined).
- ❌ setState-in-effect for state that depends on a prop change. Use the "adjust during render" pattern.
- ❌ `<section>` when there's no heading inside. Use `<div>` or `<Panel>`.
- ❌ Re-implementing `isLocked / allLocked / anyLocked` per dialog. Use `lockedFields()`.
- ❌ `e instanceof Error ? e.message : String(e)` for caught API errors. Use `extractApiError(e)`.
- ❌ Smart quotes anywhere. ASCII only.

## Common Mistakes

| Symptom | Likely cause | Fix |
|---|---|---|
| "Cannot find name 'X'" after a move | Test file's `vi.mock('../api/X')` still uses old path | Bump `../` to `../../` to match the SUT's import depth |
| Tab won't switch when clicked from outside the TabList | `TabRoot` not wired controlled (`value` + `onValueChange` both needed) | Ensure both props are passed |
| className wins/loses by source order | Tailwind v4 sorts variants alphabetically, not source-order | Use `!` to force precedence on the data-attr that should win (see `MessageRow`'s active vs read) |
| `setState in effect` warning | Effect is being used for state sync, not side effect | Move to "adjust state during render" pattern with a `lastX` tracker |
| Imports break after moving file into a deeper folder | Relative paths to `api/`/`lib/`/`hooks/` need one extra `../` | Bump each `../{api,hooks,lib,assets,test}/` → `../../$1/` |

## Validation note

This skill captures patterns from a recent refactoring pass and has not been pressure-tested with subagents per the `writing-skills` TDD methodology. Future work: write baseline scenarios (e.g. "add a new connection dialog", "extract a new tab from MessageView") and verify agents apply these conventions without prompting.
