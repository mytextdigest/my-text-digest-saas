# Enterprise Knowledge Repository — Implementation Tracker

> **For AI agents:** This file is the source of truth for task status. When you complete a task, update the `Status` field to `DONE` and fill in `Completed` date. When you start a task, set it to `IN_PROGRESS`. Add notes under the task if important decisions were made during implementation.
>
> **Reference document:** See `ENTERPRISE_KNOWLEDGE_REPO_PLAN.md` for full task specs, acceptance criteria, and architectural decisions.

---

## Status Legend

| Symbol | Meaning |
|--------|---------|
| `TODO` | Not started |
| `IN_PROGRESS` | Currently being worked on |
| `DONE` | Complete and merged |
| `BLOCKED` | Waiting on a dependency |
| `SKIP` | Deferred or out of scope |

---

## Milestone 0 — Spreadsheet Support (Prerequisite)

| Task ID | Title | Status | Assignee | Depends On | Started | Completed |
|---------|-------|--------|----------|------------|---------|-----------|
| `0-A` | Worker: Spreadsheet Ingestion | `DONE` | AI agent | — | 2026-06-08 | 2026-06-08 |
| `0-B` | UI: Spreadsheet File Support | `DONE` | AI agent | `0-A` | 2026-06-08 | 2026-06-08 |

### Task 0-A — Worker: Spreadsheet Ingestion
- **Status:** `DONE`
- **Key files to create/modify:**
  - `worker/extractSpreadsheet.js` (new)
  - `worker/index.js` (modified — route xlsx/csv to new extractor)
  - `prisma/schema.prisma` (add `metadata Json?` to `Chunk`)
  - New migration file
- **Notes:** Uses `xlsx` (SheetJS) to parse `.xlsx`/`.xls`/`.csv`. The extractor returns ready-made chunk records (`{ text, metadata }`) grouped by sheet and bucketed by accumulated character size, repeating column headers in each chunk's text for retrieval context. `processChunkJob` now produces a unified `chunkRecords: [{ text, metadata }]` array for both the spreadsheet path and the existing generic `chunkText()` path (non-spreadsheet docs get `metadata: null`). Migration `20260608031026_add_chunk_metadata` adds `Chunk.metadata JSONB` (applied via `prisma migrate deploy` due to pre-existing drift from `Topic`/`TopicDocument` tables — `migrate dev` would have required a destructive reset).

### Task 0-B — UI: Spreadsheet File Support
- **Status:** `DONE`
- **Key files to modify:**
  - `src/components/documents/FileUpload.jsx` (added `.csv`/`.xlsx`/`.xls` to default accepted types)
  - `src/components/documents/DocumentCard.jsx` (added `Sheet` icon mapping)
  - `src/lib/utils.js` (`getFileIcon` returns `'Sheet'` for spreadsheet extensions)
  - `src/components/layout/Sidebar.jsx` (added Excel/CSV file-type filters)
  - `src/app/(app)/document/page.jsx` — Summary tab (added a "Sheets" breakdown card derived from `chunk.metadata`, shown only for spreadsheet documents)
- **Notes:** Sheet breakdown is derived client-side from `doc.chunks[].metadata` (already included by `GET /api/documents/[id]`) — no new API endpoint needed. Full AI-generated workbook/sheet summaries and cross-sheet chat are left for a later milestone; this only surfaces the structural metadata captured during ingestion.

---

## Milestone 1 — Enterprise Foundation

| Task ID | Title | Status | Assignee | Depends On | Started | Completed |
|---------|-------|--------|----------|------------|---------|-----------|
| `1-A` | Schema: Org + RBAC Data Model | `TODO` | — | — | — | — |
| `1-B` | pgvector Migration | `TODO` | — | — | — | — |
| `1-C` | Org Creation + Invite Flow | `TODO` | — | `1-A` | — | — |

### Task 1-A — Schema: Org + RBAC Data Model
- **Status:** `TODO`
- **Key files to create/modify:**
  - `prisma/schema.prisma` (new models + extensions to existing)
  - New migration file
- **New models:** `Organization`, `OrganizationMember`, `OrganizationInvite`, `Department`, `DepartmentMember`
- **Extended models:** `User`, `Project`, `Document`, `Chunk`
- **Notes:** —

### Task 1-B — pgvector Migration
- **Status:** `TODO`
- **Key files to create/modify:**
  - `prisma/schema.prisma` (Chunk.embedding type change)
  - New migration file (with `CREATE EXTENSION IF NOT EXISTS vector`)
  - `worker/openai.js` (use `$executeRaw` for vector insert)
  - `src/lib/vectorSearch.js` (new — core similarity search utility)
  - Backfill script (one-time, e.g. `scripts/backfill-embeddings.js`)
- **Notes:** —

### Task 1-C — Org Creation + Invite Flow
- **Status:** `TODO`
- **Key files to create/modify:**
  - `src/app/api/org/route.js` (new)
  - `src/app/api/org/[orgId]/invite/route.js` (new)
  - `src/app/api/org/[orgId]/settings/route.js` (new)
  - `src/app/api/org/[orgId]/members/route.js` (new)
  - `src/app/api/org/invite/[token]/route.js` (new)
  - `src/app/api/org/invite/[token]/accept/route.js` (new)
  - `src/components/layout/Sidebar.jsx` (add workspace switcher)
  - `src/app/(app)/org/[orgId]/settings/page.jsx` (new)
  - `src/app/(app)/org/invite/[token]/page.jsx` (new)
- **Notes:** —

---

## Milestone 2 — Repository Core

| Task ID | Title | Status | Assignee | Depends On | Started | Completed |
|---------|-------|--------|----------|------------|---------|-----------|
| `2-A` | Repository API Layer | `TODO` | — | `1-A` | — | — |
| `2-B` | Department Management | `TODO` | — | `1-A`, `1-C` | — | — |
| `2-C` | Repository UI | `TODO` | — | `2-A` | — | — |

### Task 2-A — Repository API Layer
- **Status:** `TODO`
- **Key files to create/modify:**
  - `src/lib/orgGuard.js` (new — RBAC middleware)
  - `src/app/api/documents/route.js` (extend upload to accept repo scope)
  - `src/app/api/org/[orgId]/repository/route.js` (new)
  - `src/app/api/documents/[docId]/lifecycle/route.js` (new)
  - `src/app/api/projects/[projectId]/scope/route.js` (new)
- **Notes:** —

### Task 2-B — Department Management
- **Status:** `TODO`
- **Key files to create/modify:**
  - `src/app/api/org/[orgId]/departments/route.js` (new)
  - `src/app/api/org/[orgId]/departments/[deptId]/members/route.js` (new)
  - `src/app/(app)/org/[orgId]/settings/page.jsx` (add departments tab)
- **Notes:** —

### Task 2-C — Repository UI
- **Status:** `TODO`
- **Key files to create/modify:**
  - `src/app/(app)/org/[orgId]/repository/page.jsx` (new)
  - `src/components/repository/RepositoryDocumentCard.jsx` (new)
  - `src/components/repository/RepositoryFilters.jsx` (new)
  - `src/components/repository/UploadToRepositoryModal.jsx` (new)
  - `src/components/layout/Sidebar.jsx` (org nav items)
  - `src/app/(app)/project/page.jsx` (add promote-to-org toggle)
- **Notes:** —

---

## Milestone 3 — Enterprise AI

| Task ID | Title | Status | Assignee | Depends On | Started | Completed |
|---------|-------|--------|----------|------------|---------|-----------|
| `3-A` | Org-Wide Semantic Search | `TODO` | — | `1-B`, `2-A` | — | — |
| `3-B` | Enterprise Chat | `TODO` | — | `3-A` | — | — |

### Task 3-A — Org-Wide Semantic Search
- **Status:** `TODO`
- **Key files to create/modify:**
  - `src/lib/vectorSearch.js` (extend with `orgSearch()`)
  - Existing search API route (add `scope=org` mode)
- **Notes:** —

### Task 3-B — Enterprise Chat
- **Status:** `TODO`
- **Key files to create/modify:**
  - `prisma/schema.prisma` (add `OrgConversation`, `OrgMessage`)
  - New migration file
  - `src/app/api/org/[orgId]/chat/route.js` (new — streaming RAG)
  - `src/app/(app)/org/[orgId]/chat/page.jsx` (new)
  - `src/components/chat/` (extend or create org chat variant)
- **Notes:** —

---

## Architectural Decisions Log

> Do not change these without updating `ENTERPRISE_KNOWLEDGE_REPO_PLAN.md` as well.

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Inference cost | Org pays (org-level OpenAI API key on `Organization` model) | Enterprise accounts manage their own key |
| Org creation | Any authenticated user can create an org (creator = super_admin) | Slack-model, self-serve |
| Project scope | Projects promotable to org-scope via toggle | Avoids data duplication |
| Org switching UI | Sidebar workspace switcher | Familiar pattern, URL-based (`/org/[orgId]/...`) |
| Document entity | Unified — scope field on existing `Document` model | Single pipeline, no duplication |
| Vector storage | pgvector on existing Postgres | No new infra, handles org-wide scale |
| Spreadsheet timing | Prerequisite (Milestone 0 before org work) | Listed as supported doc type in repo requirements |
