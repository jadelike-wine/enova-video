# Unified Assets Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Workspace-scoped unified assets API and an independent `/app/assets` media library with image/video filters, date grouping, sorting, preview, and a standalone sidebar button.

**Architecture:** Add an `AssetsModule` beside the existing `GenerationsModule`. The service queries `assets` with a left join to `generationJobs`, maps the persisted generation output URL and prompt into a small user-facing DTO, and never accepts workspace/user identifiers from the client. The web page owns query state and renders a responsive, date-grouped media grid while existing generation history routes remain unchanged.

**Tech Stack:** NestJS, Drizzle ORM, class-validator, Swagger decorators, Next.js App Router, React, next-intl, Ant Design, Tailwind/CSS, Vitest.

---

### Task 1: Add the assets API contract and query validation

**Files:**
- Create: `apps/api/src/assets/dto/list-assets.dto.ts`
- Create: `apps/api/src/assets/assets.service.ts`
- Create: `apps/api/src/assets/assets.controller.ts`
- Create: `apps/api/src/assets/assets.module.ts`
- Modify: `apps/api/src/app.module.ts`
- Test: `apps/api/src/assets/assets.service.spec.ts`

- [ ] **Step 1: Write the failing service tests**

  Mock the injected database and assert that `list()` returns the mapped asset shape, uses the authenticated workspace id in the query, maps `generationJobs.outputJson.url` and `generationJobs.inputJson.prompt`, and applies type/sort/limit inputs. Include an asset with no generation job and expect nullable `url`, `generationId`, and `prompt`.

- [ ] **Step 2: Run the focused API test and confirm it fails**

  Run `pnpm --filter @enova/api test -- assets.service.spec.ts`.

  Expected: FAIL because the assets service/module does not exist yet.

- [ ] **Step 3: Implement the validated query DTO**

  Define `ListAssetsDto` with `@IsOptional`, `@IsEnum`, `@IsISO8601`, and `@IsInt`/`@Min`/`@Max` decorators. Use `ASSET_TYPES` plus a local `ALL` option for the query, and `NEWEST`/`OLDEST` for sorting. Keep the DTO independent of database types and let the existing global validation pipe reject malformed requests.

- [ ] **Step 4: Implement the service query and response mapper**

  Query `assets` with `leftJoin(generationJobs, eq(assets.generationJobId, generationJobs.id))`, always add `eq(assets.workspaceId, workspaceId)`, optionally add type and date predicates, and choose `desc(assets.createdAt)` or `asc(assets.createdAt)`. Limit to 1–100 after DTO validation. Map `outputJson.url` only when it is a string, and return `createdAt.toISOString()`.

- [ ] **Step 5: Implement controller and module wiring**

  Add `@Controller('api/v1/assets')`, `@UseGuards(AuthGuard)`, `@Get()`, `@ApiTags('assets')`, and `@ApiOperation`. Read `@CurrentUser()` for `workspaceId`, pass the DTO to the service, and import `AssetsModule` in `apps/api/src/app.module.ts`.

- [ ] **Step 6: Run the focused test and API typecheck**

  Run `pnpm --filter @enova/api test -- assets.service.spec.ts` and `pnpm --filter @enova/api typecheck`.

  Expected: PASS and no TypeScript errors.

- [ ] **Step 7: Commit the API slice**

  Run `git add apps/api/src/assets apps/api/src/app.module.ts && git commit -m "feat(api): add workspace assets endpoint"`.

### Task 2: Add the web API client and asset page model helpers

**Files:**
- Modify: `apps/web/lib/api.ts`
- Create: `apps/web/components/application/assets/asset-view.ts`
- Test: `apps/web/components/application/assets/asset-view.spec.ts`

- [ ] **Step 1: Write failing pure-function tests**

  Cover `groupAssetsByDate()` with assets from two calendar dates, `formatAssetDate()` using a fixed locale/date, and `buildAssetsQuery()` for default values, image/video type, date range, and oldest sorting.

- [ ] **Step 2: Run the focused Web test and confirm it fails**

  Run `pnpm --filter @enova/web test -- asset-view.spec.ts`.

  Expected: FAIL because the helper module does not exist.

- [ ] **Step 3: Add the typed client contract and API method**

  Add `AssetType`, `AssetSort`, `Asset`, and `ListAssetsParams` types to `apps/web/lib/api.ts`; add `assetsApi.list(params)` that URL-encodes `type`, `from`, `to`, `sort`, and `limit` and calls `/assets`.

- [ ] **Step 4: Implement pure helpers**

  Implement deterministic grouping by the user-visible local calendar date, preserving API order inside each group. Use `Intl.DateTimeFormat` for the group label and a stable query-string builder that omits default/empty values.

- [ ] **Step 5: Run the focused helper tests**

  Run `pnpm --filter @enova/web test -- asset-view.spec.ts`.

  Expected: PASS.

### Task 3: Create the standalone assets page

**Files:**
- Create: `apps/web/app/[locale]/app/assets/page.tsx`
- Create: `apps/web/components/application/AssetsView.tsx`
- Create: `apps/web/components/application/assets/assets-view.module.css`
- Modify: `apps/web/messages/zh-CN.json`
- Modify: `apps/web/messages/en.json`

- [ ] **Step 1: Implement the page metadata wrapper**

  Follow the existing history page pattern: load `metadata` translations on the server and render `<AssetsView />` from the new route.

- [ ] **Step 2: Implement initial asset loading and query state**

  In `AssetsView`, keep `type`, `datePreset`, `from`, `to`, and `sort` in React state. Fetch `assetsApi.list()` whenever the query state changes, guard against stale responses with an incrementing request id, show the existing `message.error`/dialog path on failure, and render a loading state during the first request.

- [ ] **Step 3: Implement the reference-inspired header and filters**

  Render the title, type tabs (`全部`/`图片`/`视频`), and three dropdown controls (`筛选`, `时间`, `排序`). Use Ant Design `Dropdown`/`Menu` or the existing project primitive; show a check mark on the active option and close the menu after selection. The filter menu includes `全部`, `图片`, `视频`; the time menu includes `全部`, `最近一周`, `最近一个月`, `最近三个月`, and a custom date range using two date inputs; sort includes `近→远` and `远→近`.

- [ ] **Step 4: Implement grouped responsive media rendering**

  Use `groupAssetsByDate()` and render one heading plus a CSS grid per date. For images, use Ant Design `Image` preview. For videos, render a muted `<video>` thumbnail with a play overlay and duration label; clicking opens a lightweight native preview modal or inline dialog. Ignore assets whose URL is null in the visual grid while keeping them in API responses.

- [ ] **Step 5: Implement loading, empty, filtered-empty, and error-safe states**

  Add skeleton tiles for initial loading, a create-first empty state linking to `/app/images`, and a “clear filters” action when a filtered query has no results. Do not display raw API error messages or provider details.

- [ ] **Step 6: Add localized copy and page styles**

  Add only the new `assets.*` translation keys to both locale files. Keep colors aligned with the current teal/slate workspace, use whitespace and media as the dominant visual, and use CSS media queries to collapse the grid and allow filter wrapping below 900px.

- [ ] **Step 7: Run Web tests and typecheck**

  Run `pnpm --filter @enova/web test -- asset-view.spec.ts` and `pnpm --filter @enova/web typecheck`.

  Expected: PASS and no TypeScript errors.

### Task 4: Make Assets a standalone sidebar entry

**Files:**
- Modify: `apps/web/app/[locale]/app/AppShell.tsx`
- Modify: `apps/web/app/[locale]/app/sidebar-navigation.ts`
- Modify: `apps/web/app/[locale]/app/sidebar-navigation.spec.ts`

- [ ] **Step 1: Extend sidebar route tests**

  Assert `/app/assets` is active only for the assets route, is not active for `/app/images/history`, and that the parent navigation class does not use prefix matching.

- [ ] **Step 2: Replace the asset expandable menu with a leaf link**

  Remove `assetMenu` and add an `assetNavItem` with path `/app/assets`, label key `navigation.assets`, and `FolderOpenOutlined`. Render it once in the normal user navigation and once in the admin personal section, preserving existing generation menus and settings.

- [ ] **Step 3: Run sidebar tests**

  Run `pnpm --filter @enova/web test -- sidebar-navigation.spec.ts`.

  Expected: PASS.

### Task 5: Regenerate API artifacts and run the repository verification suite

**Files:**
- Generated only if the repository workflow changes them: `apps/api/openapi.json`, `packages/sdk/*`
- No database migration files expected.

- [ ] **Step 1: Start the API or use the repository OpenAPI generation command**

  Regenerate `apps/api/openapi.json` using the existing project procedure after the controller is compiled. Then run `pnpm sdk:generate` if the generated SDK includes the new endpoint.

- [ ] **Step 2: Run targeted lint/typecheck/tests**

  Run `pnpm --filter @enova/api lint`, `pnpm --filter @enova/api typecheck`, `pnpm --filter @enova/api test -- assets`; then run the corresponding Web lint, typecheck, and assets/sidebar tests.

- [ ] **Step 3: Run the full required checks**

  Run `pnpm lint && pnpm typecheck && pnpm test && pnpm build`.

  Record any environment-blocked command with the exact error; do not report it as passed.

- [ ] **Step 4: Review the final diff and report boundaries**

  Confirm no schema migration, Worker change, secret, prompt logging, generated dependency directory, or unrelated pre-existing file was modified. Summarize changed directories, verification commands, and any OpenAPI/storage configuration risk.
