# Image Creator Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `/app/images` as a calm, immersive AI image creation workbench with a default expandable sidebar, bottom prompt composer, template-based empty state, and multi-state generation canvas while preserving all existing generation API behavior.

**Architecture:** Keep `ImageView` as the stateful orchestration boundary for form state, uploads, generation, history, and callbacks. Extract presentational workbench pieces into focused components under `apps/web/components/application/image-creator/`; pass typed values and callbacks down so the existing API payload and task state mapping remain unchanged. Keep the shared `AppShell` navigation untouched and scope the new visual shell to the image creator page.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, Tailwind CSS, Ant Design 6, `framer-motion`, Vitest.

---

### Task 1: Add animation dependency and define workbench contracts

**Files:**
- Modify: `apps/web/package.json`
- Modify: `pnpm-lock.yaml`
- Create: `apps/web/components/application/image-creator/types.ts`
- Test: `apps/web/components/application/image-creator/types.spec.ts` (type-level/utility behavior only if a runtime helper is introduced)

- [ ] **Step 1: Confirm the dependency is absent and inspect package manager state**

Run:

```bash
rg -n 'framer-motion' apps/web/package.json pnpm-lock.yaml || true
pnpm --version
```

Expected: no existing `framer-motion` dependency; pnpm is the repository-supported package manager.

- [ ] **Step 2: Add `framer-motion` to the web workspace**

Run:

```bash
pnpm --filter @enova/web add framer-motion
```

Expected: only the web package manifest and lockfile dependency graph are updated.

- [ ] **Step 3: Define component contracts**

Create `types.ts` with shared UI-only types for sidebar items, composer controls, template cards, canvas state, and image card actions. Reuse the existing `ImageTask`, `GenerationMode`, and `InputImage` shapes by exporting or moving only the types required by child components; do not introduce a second API payload type.

- [ ] **Step 4: Run the narrow web typecheck**

Run:

```bash
pnpm --filter @enova/web typecheck
```

Expected: PASS before visual components are integrated.

- [ ] **Step 5: Commit the dependency/contracts checkpoint**

```bash
git add apps/web/package.json pnpm-lock.yaml apps/web/components/application/image-creator/types.ts
git commit -m "feat(web): add image workbench contracts"
```

### Task 2: Build the reusable workbench presentation components

**Files:**
- Create: `apps/web/components/application/image-creator/Sidebar.tsx`
- Create: `apps/web/components/application/image-creator/PromptComposer.tsx`
- Create: `apps/web/components/application/image-creator/ModelSelector.tsx`
- Create: `apps/web/components/application/image-creator/CreationTemplates.tsx`
- Create: `apps/web/components/application/image-creator/GenerationCanvas.tsx`
- Create: `apps/web/components/application/image-creator/ImageGrid.tsx`
- Create: `apps/web/components/application/image-creator/ImageCard.tsx`
- Create: `apps/web/components/application/image-creator/image-creator.css`

- [ ] **Step 1: Implement `Sidebar` with default wide mode and collapse control**

Use a controlled `collapsed` prop and `onCollapsedChange` callback. Render the requested user-facing items, a teal active state, tooltips/labels, credits, avatar/email, and a button with `aria-expanded`. Animate width and label opacity with `framer-motion`; do not move or mutate the shared AppShell navigation.

- [ ] **Step 2: Implement compact `ModelSelector` controls**

Render model, ratio, and size as compact toolbar controls using the existing `IMAGE_MODELS`, `IMAGE_RATIOS`, and `IMAGE_QUALITY_SIZES` option values. Expose `value`/`onChange` callbacks matching the current form fields, and include the current dimensions as secondary text when available.

- [ ] **Step 3: Implement `PromptComposer` around the existing form submission boundary**

Render the prompt field, upload trigger/previews, mode selector, model selector, ratio, quality, cost/balance hint, error message, and circular submit button. Use the existing `Form` instance or a typed submit callback supplied by `ImageView`; preserve prompt max length, mode-specific upload rules, and generating/uploading labels.

- [ ] **Step 4: Implement `CreationTemplates` and template fill callbacks**

Render exactly three horizontal template cards with image-led gradients or existing-safe local visual treatments. Each card calls `onSelect(prompt)` and never calls `generationApi` directly. Add hover/focus motion and keyboard-accessible buttons.

- [ ] **Step 5: Implement `GenerationCanvas`, `ImageGrid`, and `ImageCard`**

Map the existing preview states to:

```text
empty      -> centered AI mark and “输入描述开始创作”
generating -> four responsive shimmer tiles plus progress/status text
success    -> 2/4-column image grid with hover action rail
error      -> existing error copy and regenerate action
```

`ImageCard` receives callbacks for download, regenerate, edit, copy prompt, and delete/favorite UI. It must not invent a persistence API for favorite.

- [ ] **Step 6: Add scoped CSS for focus rings, shimmer, responsive layout, and reduced motion**

Use the existing green brand color, `#FAFAFA` page background, generous spacing, 16–20px radii, no routine panel shadows, and `prefers-reduced-motion` fallbacks. Keep styles scoped to the image creator components rather than changing global admin styles.

- [ ] **Step 7: Run lint and typecheck on the new components**

Run:

```bash
pnpm --filter @enova/web lint
pnpm --filter @enova/web typecheck
```

Expected: PASS; any unused imports or invalid Ant Design props are fixed before integration.

- [ ] **Step 8: Commit the component checkpoint**

```bash
git add apps/web/components/application/image-creator
git commit -m "feat(web): add image creator workbench components"
```

### Task 3: Recompose `ImageView` without changing API behavior

**Files:**
- Modify: `apps/web/components/application/ImageView.tsx`
- Test: `apps/web/components/application/ImageView.spec.tsx` (add only if existing test conventions support component tests; otherwise validate with the web test suite and manual flow)

- [ ] **Step 1: Preserve and isolate existing generation orchestration**

Keep `toImageTask`, `getPreviewState`, upload validation, `uploadLocalFiles`, `generate`, `fillFormFromTask`, download, regeneration, initial history load, and cleanup behavior. Make only the minimum type/export adjustments needed for child component props.

- [ ] **Step 2: Add page-local collapsed state with wide default**

Initialize `collapsed` to `false`. Optionally read/write a namespaced local-storage key only after hydration; if unavailable, fall back to wide mode. Pass the state to `Sidebar` and apply the corresponding workbench grid width without changing route behavior.

- [ ] **Step 3: Replace the current two-panel return tree**

Compose `ImageCreatorLayout` behavior directly in `ImageView` (or create the named layout component if the resulting file remains clearer): `Sidebar`, main canvas, `CreationTemplates` for empty state, `GenerationCanvas` for current task, and sticky bottom `PromptComposer`. The composer’s submit must call the same `Form`/`generate` path and the template callback must call `form.setFieldsValue({ prompt })` plus `setPromptValue(prompt)`.

- [ ] **Step 4: Map existing action callbacks into cards**

Wire download to `downloadImage`, regenerate to `regenerateFromTask`, edit to `fillFormFromTask`, copy to `copyPrompt`, and delete to the current history state update. Preserve selected-task semantics and do not add a second history fetch.

- [ ] **Step 5: Remove obsolete form-panel-only rendering**

Delete the old left configuration panel, bordered preview card, spinner-only generating state, and single-image success parameter block once the new components render the same information. Keep only imports used by the extracted/remaining orchestration.

- [ ] **Step 6: Run focused validation**

Run:

```bash
pnpm --filter @enova/web lint
pnpm --filter @enova/web typecheck
pnpm --filter @enova/web test
```

Expected: PASS with no API, worker, schema, OpenAPI, or SDK files changed.

- [ ] **Step 7: Commit the integration checkpoint**

```bash
git add apps/web/components/application/ImageView.tsx apps/web/components/application/image-creator
git commit -m "feat(web): redesign image generation workbench"
```

### Task 4: Verify visual states and responsive behavior

**Files:**
- Modify only if verification exposes a defect: `apps/web/components/application/image-creator/*`, `apps/web/components/application/ImageView.tsx`

- [ ] **Step 1: Start the web app with the existing local environment**

Run:

```bash
pnpm --filter @enova/web dev
```

Expected: the existing localized app starts without backend changes.

- [ ] **Step 2: Manually verify the empty state**

Open `/app/images` while authenticated and confirm the wide sidebar is shown by default, the fold button changes it to icon-only mode, the greeting and three templates are visible, and selecting a template fills the prompt.

- [ ] **Step 3: Manually verify generation and upload states**

Submit a text-to-image prompt and confirm the optimistic task, four-tile shimmer, progress copy, successful grid, and card actions. Repeat enough of `img2img`/`multi_img` to verify upload limits and mode-specific validation remain intact.

- [ ] **Step 4: Manually verify failure and recovery**

Use an existing safe failure path or mocked local response to confirm the error state keeps the regenerate action and does not expose provider secrets or raw stack traces.

- [ ] **Step 5: Verify responsive and reduced-motion behavior**

Check desktop, tablet, and narrow viewport widths; ensure the composer toolbar remains usable, sidebar labels collapse appropriately, and `prefers-reduced-motion` disables nonessential transitions.

- [ ] **Step 6: Run final repository checks appropriate to the scope**

Run:

```bash
pnpm --filter @enova/web lint
pnpm --filter @enova/web typecheck
pnpm --filter @enova/web test
pnpm --filter @enova/web build
```

Expected: all commands PASS. If an existing unrelated workspace change prevents a check, report the exact command and error rather than marking it passed.

- [ ] **Step 7: Review the diff boundary**

Run:

```bash
git status --short
git diff --name-only HEAD~3..HEAD
```

Confirm the implementation is limited to `apps/web` plus the plan/spec/lockfile changes, and that `apps/api`, `apps/worker`, `packages/*`, migrations, OpenAPI, and generated SDK files were not modified.
