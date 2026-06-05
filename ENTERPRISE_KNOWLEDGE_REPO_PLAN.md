# Enterprise Knowledge Repository — Implementation Plan

**Product:** My Text Digest  
**Feature:** Enterprise Knowledge Repository (Tier 1 — Knowledge Intelligence Core)  
**Goal:** Transform My Text Digest from a per-user document summarization platform into an AI-powered Enterprise Knowledge Management System.

---

## Product Vision

An Enterprise Knowledge Repository in My Text Digest becomes the organization's long-term memory. Employees can search, ask questions, discover expertise, and retrieve knowledge accumulated over the years — across policies, SOPs, reports, meeting notes, research, and more.

Unlike a document management system, My Text Digest understands the content and lets users interact with it through AI.

---

## Architectural Decisions (Final)

| Decision | Choice |
|----------|--------|
| **Inference cost** | Org pays — each Organization stores its own OpenAI API key |
| **Org creation** | Any authenticated user can create an Organization (creator becomes `super_admin`). Slack-model, self-serve. |
| **Project visibility** | Projects can be promoted to org-scope, making all their documents accessible to org members |
| **Org switching UI** | Slack-style sidebar workspace switcher. Navigation is URL-based: `/org/[orgId]/...` |
| **Document entity** | Unified — `scope` field added to the existing `Document` model. No duplicate pipeline. |
| **Vector storage** | pgvector extension on existing Postgres. No new infrastructure. |
| **Spreadsheet timing** | Prerequisite — spreadsheet ingestion must be complete before enterprise repo launch |

---

## System Architecture Overview

### Current Model
```
User → Projects → Documents → Chunks (JSON embeddings)
```

### Target Model
```
Personal Workspace          Org Workspace
──────────────────          ──────────────────────────────────────
User                        Organization
 └─ Projects (private)        ├─ Members (super_admin | dept_admin | employee | guest)
     └─ Documents              ├─ Departments
         └─ Chunks (vector)    │   └─ Members (admin | member)
                               ├─ Knowledge Repository
                               │   └─ Documents (scope=repository, with lifecycle + category)
                               └─ Org-Scoped Projects (promoted from personal)
                                   └─ Documents (accessible to all org members)
```

### Navigation (Sidebar Switcher)
The sidebar has a workspace switcher at the top (like Slack). Clicking it shows:
- Personal (default)
- Each org the user belongs to
- "Create Organization" option

**Personal context nav:** Dashboard, Projects, Documents, Topics  
**Org context nav:** Knowledge Repository, Enterprise Chat, Departments, Members, Settings

### URL Structure
```
Personal:   /dashboard
            /project?id=[projectId]
            /document?id=[documentId]

Org:        /org/[orgId]/repository
            /org/[orgId]/chat
            /org/[orgId]/departments
            /org/[orgId]/settings
            /org/invite/[token]
```

---

## Schema Changes

### New Models

```
Organization {
  id           String
  name         String
  openaiApiKey String?     // org-level key, used for Enterprise Chat
  createdAt    DateTime
}

OrganizationMember {
  id     String
  orgId  String → Organization
  userId String → User
  role   String  // super_admin | dept_admin | employee | guest
  // unique: [orgId, userId]
}

OrganizationInvite {
  id         String
  orgId      String → Organization
  email      String
  role       String  // role to assign on acceptance
  token      String  // unique, used in invite URL
  expiresAt  DateTime
  acceptedAt DateTime?
}

Department {
  id    String
  orgId String → Organization
  name  String
}

DepartmentMember {
  id           String
  departmentId String → Department
  userId       String → User
  role         String  // admin | member
  // unique: [departmentId, userId]
}
```

### Extended Existing Models

```
User     + (relation) orgMembers OrganizationMember[]

Project  + scope  String  @default("private")  // "private" | "org"
         + orgId  String?                       // set when scope = "org"

Document + scope        String  @default("private")  // "private" | "project" | "repository"
         + orgId        String?
         + departmentId String?
         + lifecycle    String  @default("published") // draft|published|archived|retired
         + category     String? // Policies|SOPs|Reports|Meeting Knowledge|etc.

Chunk    + metadata  Json?                          // spreadsheet sheet/table context
         + embedding changed from Json → vector(1536) via pgvector
```

### API Key Resolution (Worker)
When the worker processes a document, it resolves the API key as:
```
if document.orgId is set → use Organization.openaiApiKey
else                     → use User's setting 'openai_api_key'  (existing behavior)
```

---

## Milestone 0 — Spreadsheet Support

**Goal:** Allow users to upload, process, and chat with Excel and CSV files.  
**Why first:** Spreadsheets are listed as a core document type in the Enterprise Repository requirements. The ingestion pipeline must handle them before the repository launches.  
**Parallel-safe:** Both tasks in M0 can be worked on without touching org/RBAC code.

---

### Task 0-A — Worker: Spreadsheet Ingestion

**Owner:** Backend / Worker developer  
**Estimated scope:** Medium  
**Depends on:** Nothing

**What to build:**
- Add `xlsx` (SheetJS) npm package to the worker
- In `worker/index.js`, inside the `chunk` job: detect `.xlsx`, `.xls`, `.csv` by file extension or MIME type and route to a new `extractSpreadsheet()` function
- Create `worker/extractSpreadsheet.js`:
  - For each sheet in the workbook: detect tables, extract column headers, produce chunks of N rows
  - Each chunk carries metadata: `{ workbookName, sheetName, columnHeaders, rowRange }`
  - Prefix chunk text with `[Sheet: SheetName]` for LLM context
  - Multi-sheet workbooks: process sheets sequentially, all chunks enter the same embed pipeline
- Add `metadata Json?` field to the `Chunk` model in Prisma schema + run migration
- The embed and summarize jobs are **unchanged** — they receive chunks the same way as always

**Acceptance criteria:**
- An uploaded `.xlsx` with 3 sheets produces chunks from all 3 sheets
- Each chunk's `metadata` contains the correct `sheetName` and `columnHeaders`
- The summarize job produces a coherent workbook-level summary
- PDF and text documents are completely unaffected

---

### Task 0-B — UI: Spreadsheet File Support

**Owner:** Frontend developer  
**Estimated scope:** Small  
**Depends on:** Task 0-A

**What to build:**
- `FileUpload.jsx`: add `.xlsx`, `.xls`, `.csv` to accepted MIME types
- Summary view: if the document has chunk metadata with `sheetName`, show a workbook/sheet breakdown section
- Chat source attribution: show `[WorkbookName → SheetName]` in citations instead of just the filename

**Acceptance criteria:**
- Users can upload Excel and CSV files through the existing upload UI
- The summary page shows a per-sheet breakdown for multi-sheet workbooks
- Chat responses cite the correct sheet as the source

---

## Milestone 1 — Enterprise Foundation

**Goal:** Create the organization layer, RBAC, invite flow, and upgrade the vector store.  
**Note:** Tasks 1-A and 1-B have no dependencies and can start on day 1 in parallel with M0.

---

### Task 1-A — Schema: Org + RBAC Data Model

**Owner:** Backend developer (database-focused)  
**Estimated scope:** Medium  
**Depends on:** Nothing

**What to build:**
- All five new Prisma models listed in the Schema Changes section above
- Extensions to `User`, `Project`, `Document`, `Chunk`
- Write and test the Prisma migration — verify all existing rows are unaffected (all new fields have defaults)

**Acceptance criteria:**
- Migration runs cleanly on the existing database
- All existing API routes and functionality continue working after migration
- A User can be a member of multiple Organizations with different roles
- A Document can have `scope = "repository"` with an `orgId` set

---

### Task 1-B — pgvector Migration

**Owner:** Backend developer  
**Estimated scope:** Medium  
**Depends on:** Nothing (can run parallel to 1-A)

**What to build:**
1. Migration: `CREATE EXTENSION IF NOT EXISTS vector` + change `Chunk.embedding` from `Json` to `Unsupported("vector(1536)")?`
2. Backfill script (`scripts/backfill-embeddings.js`): reads existing JSON embeddings row by row → inserts as vector via `prisma.$executeRaw`
3. Update `worker/openai.js`: replace JSON embedding insert with `$executeRaw` vector insert
4. Create `src/lib/vectorSearch.js` with:

```js
// Project-scoped search (replaces current in-memory cosine similarity)
similaritySearch(queryEmbedding, { projectId, limit })

// Org-wide search (used by Enterprise Chat and org search)
orgSearch(queryEmbedding, { userId, orgId, limit })
// → queries Source A (scope=repository docs in user's depts)
// → queries Source B (docs in org-scoped projects)
// → RBAC filter is in the SQL WHERE clause, not post-filter
```

**Acceptance criteria:**
- All existing document chat and project chat continue working after migration
- Existing embeddings are correctly backfilled (spot-check cosine similarity results match previous behavior)
- `similaritySearch()` returns correct results for a known query
- Worker correctly inserts new embeddings as vectors

---

### Task 1-C — Org Creation + Invite Flow

**Owner:** Full-stack developer  
**Estimated scope:** Large  
**Depends on:** Task 1-A

**API routes to create:**

| Method | Route | Access | Description |
|--------|-------|--------|-------------|
| `POST` | `/api/org` | Any authenticated user | Create org, creator becomes `super_admin` |
| `GET` | `/api/org` | Authenticated user | List orgs the current user belongs to |
| `PATCH` | `/api/org/[orgId]/settings` | `super_admin` | Update org name and OpenAI API key |
| `GET` | `/api/org/[orgId]/members` | `super_admin` | List members and their roles |
| `POST` | `/api/org/[orgId]/invite` | `super_admin` | Generate invite token, send email |
| `GET` | `/api/org/invite/[token]` | Public | Validate token, return org name + role |
| `POST` | `/api/org/invite/[token]/accept` | Authenticated user | Create member record, mark invite accepted |

**UI to create:**
- `Sidebar.jsx`: workspace switcher at top — "Personal" + user's orgs + "Create Organization" option
- Org creation: modal or page — name input → creates org → redirects to `/org/[orgId]/settings`
- `/org/[orgId]/settings`: org name field, masked API key input (show/hide toggle), members table with roles, invite form (email + role select)
- `/org/invite/[token]`: shows org name and role being offered, Accept / Decline buttons
- Post-login: if pending invites exist for user's email → show a banner or prompt

**Acceptance criteria:**
- A user can create an organization and is automatically set as `super_admin`
- `super_admin` can invite a user by email; invited user receives an email with the invite link
- Invited user can accept the invite and appears in the members list with the assigned role
- The sidebar workspace switcher shows all orgs the user belongs to
- Switching workspace navigates to `/org/[orgId]/...` routes
- The org's OpenAI API key can be set and updated by `super_admin`

---

## Milestone 2 — Repository Core

**Goal:** Build the Knowledge Repository — upload, browse, filter, and manage org documents.  
**Depends on:** Milestone 1 complete.

---

### Task 2-A — Repository API Layer

**Owner:** Backend developer  
**Estimated scope:** Medium-Large  
**Depends on:** Task 1-A

**What to build:**
- `src/lib/orgGuard.js`: middleware function — given a request and `orgId`, resolve the member's role or throw `403`. Used by all org API routes.
- Extend `POST /api/documents`: accept additional fields `scope`, `orgId`, `departmentId`, `category`. Validate that the user is an org member before accepting a repository-scoped upload. The worker pipeline is unchanged.

**New API routes:**

| Method | Route | Access | Description |
|--------|-------|--------|-------------|
| `GET` | `/api/org/[orgId]/repository` | Org member | List repository docs with filters: dept, category, lifecycle, fileType, date range, page |
| `PATCH` | `/api/documents/[docId]/lifecycle` | `super_admin` or `dept_admin` | Update lifecycle: draft → published → archived → retired |
| `PATCH` | `/api/projects/[projectId]/scope` | `super_admin` | Promote project to org-scope (`scope=org`, set `orgId`) |

**Acceptance criteria:**
- Non-org-members cannot access any `/api/org/[orgId]/...` routes
- Repository listing correctly returns both `scope=repository` documents and documents from org-scoped projects
- Lifecycle state transitions are enforced (only valid transitions allowed)
- All filters work correctly in combination

---

### Task 2-B — Department Management

**Owner:** Full-stack developer  
**Estimated scope:** Medium  
**Depends on:** Tasks 1-A and 1-C

**API routes to create:**

| Method | Route | Access | Description |
|--------|-------|--------|-------------|
| `POST` | `/api/org/[orgId]/departments` | `super_admin` | Create department |
| `GET` | `/api/org/[orgId]/departments` | Org member | List departments with member counts |
| `POST` | `/api/org/[orgId]/departments/[deptId]/members` | `super_admin` or `dept_admin` | Add member to department |
| `DELETE` | `/api/org/[orgId]/departments/[deptId]/members/[userId]` | `super_admin` or `dept_admin` | Remove member from department |

**UI:**  
Add a **Departments** tab inside `/org/[orgId]/settings`:
- Create department form
- List of departments with member count
- Per-department: member list, add/remove members, set dept admin

**Acceptance criteria:**
- `super_admin` can create departments and assign members
- A `dept_admin` can manage their own department's members but not others
- Department membership correctly scopes document access (Finance docs not visible to HR members)

---

### Task 2-C — Repository UI

**Owner:** Frontend developer  
**Estimated scope:** Large  
**Depends on:** Task 2-A

**What to build:**

**New page: `/org/[orgId]/repository`**
- Filter bar at the top:
  - Department dropdown (all departments the user can access)
  - Category dropdown (Policies, SOPs, Reports, Meeting Knowledge, Product Knowledge, Historical Documents, Other)
  - Lifecycle tabs: All / Published / Draft / Archived / Retired
  - File type filter: PDF, Spreadsheet, Text, All
  - Date range picker
- Document grid below filters (reuse `DocumentCard` pattern with org-specific fields)
- Each card shows: filename, lifecycle badge (color-coded), department tag, category tag, upload date, file type icon
- Upload button → opens upload modal with dept + category selection in addition to standard file picker

**Lifecycle badge colors:**
- Published → green
- Draft → yellow / amber
- Archived → grey
- Retired → red

**Sidebar updates:**
- In org context, show: Knowledge Repository, Enterprise Chat, Departments, Members, Settings

**Project settings:**
- Add "Share with Organization" toggle on the project page
- On enable: calls `PATCH /api/projects/[projectId]/scope`, shows confirmation dialog

**Acceptance criteria:**
- Users can browse and filter the repository by all filter combinations
- Lifecycle badges are correctly color-coded and reflect the document's current state
- Upload modal correctly sends `scope=repository`, `orgId`, and optional `departmentId` + `category`
- Department members only see documents from departments they belong to
- The "Share with Organization" toggle works on the project page

---

## Milestone 3 — Enterprise AI

**Goal:** Org-wide semantic search and "Chat with Organization" RAG.  
**Depends on:** Milestones 1 and 2 complete.

---

### Task 3-A — Org-Wide Semantic Search

**Owner:** Backend / AI developer  
**Estimated scope:** Medium  
**Depends on:** Tasks 1-B and 2-A

**What to build:**
- Extend `src/lib/vectorSearch.js` with `orgSearch()`:
  - Resolve user's department memberships from DB
  - Source A query: chunks from `scope=repository` docs where `departmentId` is in user's accessible depts (or `departmentId IS NULL` for org-wide docs)
  - Source B query: chunks from docs in projects where `project.scope = 'org'` and `project.orgId = orgId`
  - Both queries use pgvector `<=>` ANN operator
  - RBAC filtering is in the SQL `WHERE` clause — not post-query filtering
  - Merge and re-rank results by similarity score, return top-K
- Extend existing search API route: add `?scope=org&orgId=[orgId]` mode that calls `orgSearch()`

**Acceptance criteria:**
- Org search returns results from both repository documents and org-scoped project documents
- A user in the HR department does not receive chunks from Finance-only documents
- Search performance is acceptable for a repository of 1000+ documents
- Personal search behavior is completely unchanged

---

### Task 3-B — Enterprise Chat

**Owner:** Full-stack developer  
**Estimated scope:** Large  
**Depends on:** Task 3-A

**What to build:**

**Schema additions:**
```
OrgConversation { id, orgId, userId, createdAt }
OrgMessage      { id, conversationId, role, content, createdAt }
```

**New API route: `POST /api/org/[orgId]/chat`**
- Streaming endpoint (same pattern as existing project chat)
- Steps:
  1. Embed the user's query using the org's OpenAI API key
  2. Call `orgSearch()` to retrieve top-K chunks
  3. Build context prompt with retrieved chunks
  4. Stream completion using org's `openaiApiKey`
  5. Save conversation + messages to `OrgConversation` / `OrgMessage`
- Source citations in the response include: document name, department

**New page: `/org/[orgId]/chat`**
- Title: "Chat with Organization"
- Same chat interface pattern as existing project chat
- Source cards below answers show: `[Document Name → Department]`
- Conversation history sidebar (list of past `OrgConversation` records)

**Acceptance criteria:**
- Users can ask questions and receive answers synthesized from org knowledge
- Answers correctly cite the source document and department
- Only documents the user has access to (per RBAC) are used as context
- The org's OpenAI API key is used for inference — not the user's personal key
- Conversation history is saved and can be resumed

---

## Dependency Graph

```
0-A (worker spreadsheet) ──→ 0-B (UI spreadsheet)

1-A (schema) ─────┬──────────────────────────────→ 2-A (repo API) ──→ 2-C (repo UI)
                  │                                                  └──→ 3-A (org search) ──→ 3-B (chat)
                  └──→ 1-C (onboarding/invite) ──→ 2-B (departments)

1-B (pgvector) ───────────────────────────────────────────────────→ 3-A (org search)
```

**Tasks safe to start on day 1 (no dependencies):** `0-A`, `1-A`, `1-B`

---

## Task Assignment Summary

| Task | Title | Milestone | Suggested Role |
|------|-------|-----------|----------------|
| `0-A` | Worker: Spreadsheet Ingestion | M0 | Worker / Backend dev |
| `0-B` | UI: Spreadsheet File Support | M0 | Frontend dev |
| `1-A` | Schema: Org + RBAC Data Model | M1 | Backend dev (DB) |
| `1-B` | pgvector Migration | M1 | Backend dev (DB) |
| `1-C` | Org Creation + Invite Flow | M1 | Full-stack dev |
| `2-A` | Repository API Layer | M2 | Backend dev |
| `2-B` | Department Management | M2 | Full-stack dev |
| `2-C` | Repository UI | M2 | Frontend dev |
| `3-A` | Org-Wide Semantic Search | M3 | Backend / AI dev |
| `3-B` | Enterprise Chat | M3 | Full-stack dev |

---

## Tracking

See `IMPLEMENTATION_TRACKER.md` for live task status, assignees, and implementation notes.
