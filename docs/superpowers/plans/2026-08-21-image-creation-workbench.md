# Image Creation Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `/app/images` as a calm AI creation workbench with a compact creator navigation, an on-demand task-conversation panel, contextual generation results, and a fixed ChatGPT-style prompt composer while preserving the existing generation pipeline.

**Architecture:** Existing `Generation` records remain the only persisted source of truth. Pure projection helpers turn `ImageTask` values into conversation titles and metadata, presentational components render the conversation overlay and workspace header, and `ImageView` continues to own generation, upload, polling, form, and selection state. `AppShell` selects a creator navigation on normal `/app/*` routes and the existing admin navigation only on `/app/admin/*` routes.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, Ant Design 6, Tailwind CSS, CSS Modules, Vitest/jsdom.

---

## File map

- Create `apps/web/components/application/image-creator/workbench.ts`: pure task-to-conversation and metadata projection helpers.
- Create `apps/web/components/application/image-creator/workbench.spec.ts`: unit coverage for projection fallbacks and shell route mode.
- Create `apps/web/components/application/image-creator/ConversationPanel.tsx`: floating recent-creation panel with new/default creation actions.
- Create `apps/web/components/application/image-creator/WorkspaceHeader.tsx`: current conversation trigger, title, and task metadata.
- Modify `apps/web/components/application/ImageView.tsx`: integrate the conversation overlay, selection/new-conversation behavior, header, canvas, and composer spacing without changing API calls.
- Modify `apps/web/components/application/image-creator/GenerationCanvas.tsx`: keep state rendering but constrain results to the selected task context.
- Modify `apps/web/components/application/image-creator/PromptComposer.tsx`: refine toolbar grouping and accessibility while preserving callbacks.
- Modify `apps/web/components/application/image-creator/ImageCard.tsx`: add a compact overflow action and polish hover behavior without claiming persistent favorites.
- Modify `apps/web/components/application/image-creator/image-creator.module.css`: workbench, overlay, gallery, composer, hover, motion, and responsive styles.
- Modify `apps/web/app/[locale]/app/AppShell.tsx`: route-aware creator/admin navigation split and compact creator rail.
- Modify `apps/web/app/globals.css`: shell-only layout styles.
- Modify `apps/web/messages/zh-CN.json` and `apps/web/messages/en.json`: creator navigation and workbench strings.
- Modify `docs/product-reference.md`: document the task-history conversation projection as a UI behavior, not a persisted Conversation capability.

### Task 1: Add tested workbench projections

**Files:**
- Create: `apps/web/components/application/image-creator/workbench.spec.ts`
- Create: `apps/web/components/application/image-creator/workbench.ts`

- [ ] **Step 1: Write the failing projection tests**

```ts
import { describe, expect, it } from 'vitest'
import { conversationTitle, taskMetadata, workspaceShellMode } from './workbench'
import type { ImageTask } from './types'

const task = (overrides: Partial<ImageTask> = {}): ImageTask => ({
  id: 'generation-1',
  status: 'SUCCEEDED',
  prompt: 'A luminous floating city above a misty canyon\nwith cinematic light',
  model: 'agnes-image-2.1-flash',
  ratio: '1:1',
  size: '1K',
  created_at: '2026-08-21T08:30:00.000Z',
  ...overrides,
})

describe('image workbench projections', () => {
  it('uses the first prompt line as a compact conversation title', () => {
    expect(conversationTitle(task(), 'Untitled creation', 32)).toBe('A luminous floating city above…')
  })

  it('uses a fallback title when the prompt is blank', () => {
    expect(conversationTitle(task({ prompt: '  ' }), 'Untitled creation')).toBe('Untitled creation')
  })

  it('returns only available metadata values', () => {
    expect(taskMetadata(task({ size: undefined }))).toEqual(['agnes-image-2.1-flash', '1:1'])
  })

  it('separates admin routes from creator routes', () => {
    expect(workspaceShellMode('/app/admin/settings')).toBe('admin')
    expect(workspaceShellMode('/app/images')).toBe('creator')
  })
})
```

- [ ] **Step 2: Run the test and verify RED**

Run: `pnpm --filter @enova/web test -- components/application/image-creator/workbench.spec.ts`

Expected: FAIL because `./workbench` does not exist.

- [ ] **Step 3: Implement the minimal pure helpers**

```ts
import type { ImageTask } from './types'

export function conversationTitle(task: ImageTask | null, fallback: string, maxLength = 36): string {
  const firstLine = task?.prompt?.trim().split(/\r?\n/, 1)[0]?.trim()
  if (!firstLine) return fallback
  return firstLine.length > maxLength ? `${firstLine.slice(0, maxLength - 1).trimEnd()}…` : firstLine
}

export function taskMetadata(task: ImageTask | null): string[] {
  if (!task) return []
  return [task.model, task.ratio, task.size].filter((value): value is string => Boolean(value))
}

export function workspaceShellMode(pathname: string): 'admin' | 'creator' {
  return pathname === '/app/admin' || pathname.startsWith('/app/admin/') ? 'admin' : 'creator'
}
```

- [ ] **Step 4: Run the test and verify GREEN**

Run: `pnpm --filter @enova/web test -- components/application/image-creator/workbench.spec.ts`

Expected: 4 tests pass.

### Task 2: Build the conversation overlay and workspace header

**Files:**
- Create: `apps/web/components/application/image-creator/ConversationPanel.tsx`
- Create: `apps/web/components/application/image-creator/WorkspaceHeader.tsx`
- Modify: `apps/web/components/application/image-creator/image-creator.module.css`

- [ ] **Step 1: Add a failing render test for conversation semantics**

Extend `workbench.spec.ts` with a jsdom render test that supplies one successful task and verifies the panel exposes buttons named `新对话`, `默认创作`, and the projected prompt title, and marks the selected item with `aria-current="true"`.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm --filter @enova/web test -- components/application/image-creator/workbench.spec.ts`

Expected: FAIL because `ConversationPanel` does not exist.

- [ ] **Step 3: Implement `ConversationPanel`**

The component accepts exactly these props:

```ts
interface ConversationPanelProps {
  open: boolean
  tasks: ImageTask[]
  selectedTaskId: string | number | null
  onClose: () => void
  onNewConversation: () => void
  onSelectTask: (task: ImageTask) => void
}
```

Render a backdrop button, an `aside` with `aria-label="创作列表"`, a new-conversation button, a default-creation button, and recent task buttons. Use `conversationTitle`; show `output_url` as a native image thumbnail, otherwise show a status glyph. Selecting an item calls `onSelectTask(task)` and `onClose()`.

- [ ] **Step 4: Implement `WorkspaceHeader`**

Accept the current task, panel-open state, and toggle callback. Render the current conversation title in the trigger, a page title derived from the selected prompt, the full prompt below it, metadata chips from `taskMetadata`, and a localized/defensive formatted creation time.

- [ ] **Step 5: Add the overlay and header CSS**

Use a 280px desktop overlay anchored below the trigger, opacity/translate entrance motion, 12–16px radii, one-pixel neutral borders, and a subtle shadow. At widths below 760px, make the panel a left-side fixed drawer with a full-height backdrop. Disable transitions under `prefers-reduced-motion`.

- [ ] **Step 6: Run the focused tests and verify GREEN**

Run: `pnpm --filter @enova/web test -- components/application/image-creator/workbench.spec.ts`

Expected: all projection and conversation render tests pass.

### Task 3: Integrate task conversations into `ImageView`

**Files:**
- Modify: `apps/web/components/application/ImageView.tsx`
- Modify: `apps/web/components/application/image-creator/GenerationCanvas.tsx`

- [ ] **Step 1: Add state-transition coverage**

Add pure helper coverage or a focused component test proving that “new conversation” yields no selected task and blank prompt defaults, while selecting a task supplies its prompt/model/mode/ratio/size values.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm --filter @enova/web test -- components/application/image-creator/workbench.spec.ts`

Expected: FAIL because the selection projection helper is missing.

- [ ] **Step 3: Add the selection projection helper**

Implement:

```ts
export function formValuesFromTask(task: ImageTask): ImageFormValues {
  return {
    model: task.model || DEFAULT_IMAGE_MODEL,
    mode: task.mode || 'text2img',
    prompt: task.prompt || '',
    size: task.size || '1K',
    ratio: task.ratio || '1:1',
  }
}
```

Update the existing `fillFormFromTask` callback to consume this helper.

- [ ] **Step 4: Integrate the overlay and header**

Add `conversationOpen` state. `onNewConversation` must clear `selectedTaskId`, prompt, error, input previews, mode, and form fields without issuing an API call. `onSelectTask` must reuse `fillFormFromTask`, set the selected ID, and close the panel.

Replace the current page header with `WorkspaceHeader`. Keep the existing API-key warning, empty templates, polling, upload, optimistic task replacement, and generation callbacks intact.

- [ ] **Step 5: Restrict the canvas to the selected context**

Pass `[selectedTask]` to the success canvas rather than all history. This prevents unrelated task outputs from appearing as if they belong to one persisted conversation. Preserve the grid API so future multi-result tasks can expand naturally.

- [ ] **Step 6: Run focused tests and typecheck**

Run: `pnpm --filter @enova/web test -- components/application/image-creator/workbench.spec.ts`

Run: `pnpm --filter @enova/web typecheck`

Expected: tests pass and TypeScript exits 0.

### Task 4: Refine gallery actions and Prompt Composer

**Files:**
- Modify: `apps/web/components/application/image-creator/PromptComposer.tsx`
- Modify: `apps/web/components/application/image-creator/ImageCard.tsx`
- Modify: `apps/web/components/application/image-creator/image-creator.module.css`

- [ ] **Step 1: Add composer interaction tests**

Render `PromptComposer` with lightweight Ant Design mocks. Verify Enter calls `onSubmit`, Shift+Enter does not, and a blank prompt disables the generate button.

- [ ] **Step 2: Run the focused test and verify RED if semantics are missing**

Run: `pnpm --filter @enova/web test -- components/application/image-creator/workbench.spec.ts`

Expected: any missing semantics fail with the matching assertion; existing behavior may pass and serves as characterization before markup refactoring.

- [ ] **Step 3: Group composer controls without changing callbacks**

Create semantic left/mode/settings/action groups inside the toolbar. Keep the existing upload picker, preview replacement/deletion, mode/model/ratio/size callbacks, estimated Credits, balance, loading label, input length, and Enter handling. Add visible text to the upload control on larger screens and icon-only behavior on small screens through CSS.

- [ ] **Step 4: Refine image actions**

Keep download, regenerate, edit, copy prompt, and local-only favorite actions. Move destructive/local hide behind a compact overflow affordance so the hover rail stays sparse. Do not label the local hide action as a server deletion.

- [ ] **Step 5: Apply final visual styles**

Set a maximum content width around 1440px, support 1/2/4 result columns, reduce routine borders, use the existing primary accent only for selected/action states, reserve bottom scroll space for the composer, and ensure touch devices can access image actions without hover.

- [ ] **Step 6: Run focused tests and typecheck**

Run: `pnpm --filter @enova/web test -- components/application/image-creator/workbench.spec.ts`

Run: `pnpm --filter @enova/web typecheck`

Expected: tests pass and TypeScript exits 0.

### Task 5: Separate creator and admin navigation surfaces

**Files:**
- Modify: `apps/web/app/[locale]/app/AppShell.tsx`
- Modify: `apps/web/app/globals.css`
- Modify: `apps/web/messages/zh-CN.json`
- Modify: `apps/web/messages/en.json`

- [ ] **Step 1: Use the tested route mode in `AppShell`**

Call `workspaceShellMode(pathname)`. On admin routes render only the existing administrator navigation and retain the admin role boundary. On all other routes, including when the signed-in user is an administrator, render only the creator navigation.

- [ ] **Step 2: Replace the creator menu hierarchy**

Render the compact first-level creator entries `灵感`, `生成`, `资产`, and `画布`. `生成` keeps image and video routes reachable through its flyout/submenu; `资产` links to existing history. Mark unimplemented inspiration/canvas actions as reserved and non-clickable rather than routing to fake pages.

- [ ] **Step 3: Preserve account utilities**

Keep Credits, settings, language, account identity, logout, configured docs, and user-visible custom menu behavior outside the primary creative navigation. Do not expose provider, pricing, audit, or system settings on creator routes.

- [ ] **Step 4: Finalize compact shell CSS**

Use an approximately 88px creator rail with vertically centered icon/label items and a wider admin sidebar on admin routes. Keep the mobile drawer and route pending overlay. Avoid page-level card framing around the workbench.

- [ ] **Step 5: Validate localization files**

Run: `node -e "JSON.parse(require('fs').readFileSync('apps/web/messages/zh-CN.json')); JSON.parse(require('fs').readFileSync('apps/web/messages/en.json'))"`

Expected: exit 0 with no output.

- [ ] **Step 6: Run web lint and typecheck**

Run: `pnpm --filter @enova/web lint`

Run: `pnpm --filter @enova/web typecheck`

Expected: both commands exit 0.

### Task 6: Update product facts and run completion verification

**Files:**
- Modify: `docs/product-reference.md`

- [ ] **Step 1: Update the image-generation product facts**

Document that `/app/images` projects existing generation history into a collapsible recent-creation panel and that this is not the removed text Conversation model or a new persisted generation-conversation model.

- [ ] **Step 2: Run the full web verification suite**

Run: `pnpm --filter @enova/web lint`

Run: `pnpm --filter @enova/web typecheck`

Run: `pnpm --filter @enova/web test`

Run: `pnpm --filter @enova/web build`

Expected: each command exits 0. If build requires unavailable external services, report the exact failure and retain the successful local checks.

- [ ] **Step 3: Inspect the final diff**

Run: `git diff --check`

Run: `git status --short`

Confirm no database migration, OpenAPI file, generated SDK, secret, build artifact, or unrelated workspace file was added.

- [ ] **Step 4: Perform a responsive visual smoke test**

Open `/zh-CN/app/images` at desktop and mobile widths. Verify the creator rail, conversation overlay/drawer, empty state, selected task state, hover/touch actions, fixed composer, and admin-route navigation separation.

