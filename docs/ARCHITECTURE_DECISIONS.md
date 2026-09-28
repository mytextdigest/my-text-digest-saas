# Enterprise Knowledge Repository — Architecture Decisions

**Project:** My Text Digest — Enterprise Platform Transformation  
**Date:** 2026-06-05  
**Status:** Finalized

This document explains every major architectural decision made for the Enterprise Knowledge Repository feature — what we chose, what we rejected, and why. It is intended for developers, architects, and technical stakeholders joining the project.

---

## Table of Contents

1. [Multi-Tenancy Model](#1-multi-tenancy-model)
2. [Organization Creation Flow](#2-organization-creation-flow)
3. [Role-Based Access Control (RBAC)](#3-role-based-access-control-rbac)
4. [Document Scope — Unified vs Separate Entity](#4-document-scope--unified-vs-separate-entity)
5. [Project Promotion to Org-Scope](#5-project-promotion-to-org-scope)
6. [Vector Storage — pgvector](#6-vector-storage--pgvector)
7. [API Key Resolution for Inference](#7-api-key-resolution-for-inference)
8. [Org Switching UI — Sidebar Switcher](#8-org-switching-ui--sidebar-switcher)
9. [URL Routing Strategy](#9-url-routing-strategy)
10. [Org-Wide RAG Architecture](#10-org-wide-rag-architecture)
11. [Document Lifecycle Management](#11-document-lifecycle-management)
12. [Spreadsheet Ingestion Strategy](#12-spreadsheet-ingestion-strategy)
13. [Worker Pipeline — Minimal Changes](#13-worker-pipeline--minimal-changes)

---

## 1. Multi-Tenancy Model

### Decision
Add an **Organization layer above Users**. Every user retains a personal workspace. Optionally, users can belong to one or more Organizations.

### Current State vs Target State

```
BEFORE
──────
User
 ├── Projects
 │    └── Documents → Chunks
 └── (no shared knowledge, fully siloed)


AFTER
─────
Organization
 ├── Members (users with roles)
 ├── Departments
 │    └── Members
 └── Knowledge Repository
      └── Documents → Chunks

User (personal workspace, unchanged)
 └── Projects → Documents → Chunks
```

### Options Considered

| Option | Description | Verdict |
|--------|-------------|---------|
| **A — Org above User** | New Organization model, users belong to it via membership table | ✅ Chosen |
| B — Shared Project | A "super project" that all users in a team can access | ❌ Rejected — no real isolation, no RBAC, doesn't scale to departments |
| C — Separate product | Entirely separate codebase for enterprise | ❌ Rejected — too expensive, duplicates all existing work |

### Why Option A
- Clean separation between personal and org contexts
- Supports RBAC naturally (membership table carries the role)
- A user can belong to multiple organizations (consultant scenario)
- Consistent with how every major SaaS (Slack, Notion, Linear) handles multi-tenancy

---

## 2. Organization Creation Flow

### Decision
**Any authenticated user can create an Organization.** The creator automatically becomes `super_admin`. Other users join only via email invite (invite-only, no open join).

### Flow Diagram

```
User clicks "Create Organization"
           │
           ▼
   Enters org name
           │
           ▼
  POST /api/org created
           │
           ▼
  OrganizationMember record:
  { userId, orgId, role: "super_admin" }
           │
           ▼
  Redirected to /org/[orgId]/settings
           │
     ┌─────┴──────┐
     ▼            ▼
Set API Key   Invite Members
                   │
                   ▼
         POST /api/org/[orgId]/invite
         (generates token, sends email)
                   │
                   ▼
         Invitee clicks link in email
                   │
                   ▼
         POST /api/org/invite/[token]/accept
                   │
                   ▼
         OrganizationMember record created
         { userId, orgId, role: "employee" }
```

### Options Considered

| Option | Description | Verdict |
|--------|-------------|---------|
| **A — Self-serve (any user)** | Anyone can create an org; Slack/Notion model | ✅ Chosen |
| B — Admin flag on User | Platform super-admin grants `canCreateOrg` permission | ❌ Rejected — too much friction, slows enterprise adoption |
| C — Domain-based auto-join | Users with matching email domain auto-join | ❌ Rejected — complex to build, needs domain verification, deferred to future |

### Why Option A
- Lowest friction — matches how Slack, Notion, and Linear work
- No platform-level bottleneck for org provisioning
- Invite-only joining keeps the org controlled by the creator despite open creation

---

## 3. Role-Based Access Control (RBAC)

### Decision
Two-level RBAC: **Organization level** and **Department level**. Permissions cascade downward.

### Role Hierarchy

```
Organization Level
──────────────────
super_admin   → full access: manage org, all depts, all docs, billing
dept_admin    → manage their department: members, docs, lifecycle changes
employee      → access to authorized depts, read + chat
guest         → read-only, limited access

Department Level
────────────────
admin         → manage department members and docs
member        → access department documents
```

### Permission Cascade

```
Organization
     │
     ├── super_admin ──────── can access EVERYTHING
     │
     └── Departments
              │
              ├── dept_admin ─── can manage THIS department
              │
              └── employee ───── can access THIS department's docs
```

### Document Access Resolution

```
Can user U access document D?
           │
           ▼
    Is D scope = "private"?
    ──── YES ──→ Only if D.userId == U.id
           │
           NO
           ▼
    Is D scope = "project"?
    ──── YES ──→ Only if user is in same org AND project.orgId matches
                 OR user.id == project.userId (personal project)
           │
           NO (scope = "repository")
           ▼
    Is U a member of D's Organization?
    ──── NO ───→ DENY
           │
           YES
           ▼
    Does D have a departmentId?
    ──── NO ───→ ALLOW (org-wide doc, all members can access)
           │
           YES
           ▼
    Is U a member of that Department?
    ──── NO ───→ DENY
           │
           YES
           ▼
          ALLOW
```

---

## 4. Document Scope — Unified vs Separate Entity

### Decision
**Unified Document model** — the existing `Document` entity gets a `scope` field. No separate `RepositoryDocument` model.

### Schema Extension

```
Document {
  // ── existing fields (unchanged) ──
  id, filename, filePath, content, summary,
  status, createdAt, userId, projectId, ...

  // ── new fields ──
  scope        String   @default("private")
               // "private" | "project" | "repository"

  orgId        String?  // set when scope = "repository"
  departmentId String?  // optional dept assignment
  lifecycle    String   @default("published")
               // "draft" | "published" | "archived" | "retired"
  category     String?
               // "Policies" | "SOPs" | "Reports" |
               // "Meeting Knowledge" | "Product Knowledge" |
               // "Historical Documents" | "Training Materials" | ...
}
```

### Options Considered

| Option | Description | Verdict |
|--------|-------------|---------|
| **A — Unified model** | Scope field on existing Document | ✅ Chosen |
| B — Separate entity | `RepositoryDocument` as a distinct Prisma model | ❌ Rejected |

### Why Option A — Unified Wins

```
OPTION B (Rejected) — Separate Entity
──────────────────────────────────────
Document model          RepositoryDocument model
   │                           │
   │ worker pipeline           │ separate worker pipeline
   │ embed job                 │ embed job (duplicated)
   │ summarize job             │ summarize job (duplicated)
   │ chat API                  │ chat API (duplicated)
   └── one code path           └── second code path to maintain


OPTION A (Chosen) — Unified Model
──────────────────────────────────
         Document model
              │
              │ scope = "private" → personal doc
              │ scope = "project" → project doc
              │ scope = "repository" → org repository doc
              │
              └── ONE pipeline handles all three
                  (worker is completely unchanged)
```

**Benefits of Option A:**
- The entire 3-stage worker pipeline (chunk → embed → summarize) works identically for all document types
- Chat, search, and summary APIs are the same code, just filtered by scope
- A document can be promoted from `project` → `repository` by changing one field — no data migration
- No risk of features diverging between personal and org documents

---

## 5. Project Promotion to Org-Scope

### Decision
Projects can be promoted to org-scope, making all their documents accessible to org members without moving any data.

### Schema Change

```
Project {
  // existing...
  scope  String  @default("private")  // "private" | "org"
  orgId  String?                      // set when scope = "org"
}
```

### How Org-Wide Search Resolves Documents

```
Org-wide search for user U in org O
              │
     ┌────────┴────────┐
     ▼                 ▼
  Source A          Source B
  ─────────         ─────────
  Documents where   Documents where
  scope="repository" projectId IN (
  AND orgId = O      SELECT id FROM Project
  AND dept access    WHERE scope="org"
  satisfied          AND orgId = O
                    )
     │                 │
     └────────┬────────┘
              ▼
       Merge + re-rank by
       similarity score
              │
              ▼
         Top-K results
```

### Promotion Flow (UI)

```
Project Settings Page
        │
        ▼
"Share with Organization" toggle (OFF → ON)
        │
        ▼
Confirmation dialog:
"All documents in this project will be
 accessible to all org members."
        │
        ▼
PATCH /api/projects/[projectId]/scope
{ scope: "org", orgId: "[orgId]" }
        │
        ▼
Project.scope = "org", Project.orgId = orgId
(No documents are moved or copied)
```

---

## 6. Vector Storage — pgvector

### Decision
**Add pgvector extension to existing Postgres.** Migrate `Chunk.embedding` from `Json` (array) to `vector(1536)`.

### Current vs Target

```
CURRENT STATE
─────────────
Chunk {
  embedding  Json    // float array stored as JSON string
                     // e.g. [0.012, -0.034, 0.891, ...]
}

Search process:
1. Load ALL chunks into JS memory
2. Parse JSON for each chunk
3. Compute cosine similarity in a JS loop
4. Sort results
5. Return top-K

Problem: for org-wide search across 10,000+ chunks,
this loads gigabytes of data into memory on every query.


TARGET STATE
────────────
Chunk {
  embedding  vector(1536)   // native pgvector column
}

Search process:
1. Send query vector to Postgres
2. DB computes ANN with HNSW index
3. Returns top-K rows

SELECT * FROM "Chunk"
WHERE "documentId" IN (...)  -- RBAC filter
ORDER BY embedding <=> $1    -- cosine distance operator
LIMIT 20;

All computation stays in the DB.
No data transfer until results are ready.
```

### Options Considered

| Option | Pros | Cons | Verdict |
|--------|------|------|---------|
| **pgvector** | No new infra, Postgres-native, good at 1M+ vectors | Requires extension | ✅ Chosen |
| Keep JSON | No migration needed | Falls apart at org-wide scale | ❌ Rejected |
| Pinecone / Qdrant | Best performance at massive scale | New infra, new service, added cost, complexity | ❌ Deferred |

### Migration Path

```
Step 1: Enable extension
  CREATE EXTENSION IF NOT EXISTS vector;

Step 2: Add vector column
  ALTER TABLE "Chunk"
  ADD COLUMN "embedding_vec" vector(1536);

Step 3: Backfill (one-time script)
  For each chunk with JSON embedding:
    INSERT embedding_vec = json_embedding::vector

Step 4: Update worker
  Replace JSON insert with $executeRaw vector insert

Step 5: Update search utility
  Replace JS cosine loop with SQL <=> queries

Step 6: Drop old column
  ALTER TABLE "Chunk" DROP COLUMN "embedding";
  ALTER TABLE "Chunk" RENAME "embedding_vec" TO "embedding";
```

### Index Strategy

```sql
-- HNSW index for fast approximate nearest neighbour
CREATE INDEX ON "Chunk"
USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);
```

> Add this index after backfill is complete. Building index on empty column is wasteful.

---

## 7. API Key Resolution for Inference

### Decision
The Organization stores its own OpenAI API key. The worker resolves which key to use at job time based on the document's scope.

### Resolution Logic

```
Worker receives chunk/embed/summarize job
               │
               ▼
      job.payload contains:
      { documentId, userId, orgId? }
               │
       ┌───────┴───────┐
       ▼               ▼
   orgId set?       orgId null?
       │               │
       ▼               ▼
  Fetch org        Fetch user
  openaiApiKey     Setting['openai_api_key']
       │               │
       └───────┬───────┘
               ▼
        Use resolved key
        for OpenAI calls
```

### Schema

```
Organization {
  openaiApiKey  String?   // stored encrypted at rest
}
```

### Why Not Per-User Keys for Enterprise Chat
- Enterprise Chat queries across documents from many different users
- Each document might have been uploaded by a different user with a different key
- It would be non-deterministic which key gets used and could fail if any user revokes their key
- The org key creates a predictable, admin-controlled billing relationship

---

## 8. Org Switching UI — Sidebar Switcher

### Decision
**Slack-style workspace switcher at the top of the sidebar.** No active-org cookie or session state — the active org is determined by the URL.

### Sidebar Layout

```
┌─────────────────────────┐
│  ▼  Acme Corp           │  ← Workspace switcher (clickable)
├─────────────────────────┤
│  Knowledge Repository   │
│  Enterprise Chat        │  ← Org context nav
│  Departments            │
│  Members                │
│  Settings               │
└─────────────────────────┘

Switcher dropdown (when open):
┌─────────────────────────┐
│  ✓ Acme Corp            │  ← current
│    Beta Startup         │  ← another org user belongs to
│  ─────────────────────  │
│  Personal Workspace     │
│  ─────────────────────  │
│  + Create Organization  │
└─────────────────────────┘
```

### Personal vs Org Nav

```
PERSONAL WORKSPACE          ORG WORKSPACE
──────────────────          ─────────────────────
▼ Personal                  ▼ Acme Corp
────────────────            ─────────────────────
Dashboard                   Knowledge Repository
Projects                    Enterprise Chat
Documents                   Departments
Topics                      Members
                            Settings (admin only)
```

### URL-Based Context (No Session State)

```
Personal context:
  /dashboard
  /project?id=xxx
  /document?id=xxx

Org context:
  /org/[orgId]/repository
  /org/[orgId]/chat
  /org/[orgId]/departments
  /org/[orgId]/settings
  /org/invite/[token]        ← public invite acceptance
```

**Why URL-based over session cookie:**
- Links are shareable and bookmarkable
- No state synchronization issues across tabs
- Server components can read `orgId` from params without session lookup
- Switching orgs is just navigation — no API call needed to "set" active org

---

## 9. URL Routing Strategy

### Decision
All org routes live under `/org/[orgId]/`. Personal routes remain unchanged. No breaking changes to existing URLs.

### Route Map

```
PUBLIC
  /                          Landing page
  /auth/signin
  /auth/signup
  /org/invite/[token]        Invite acceptance (public, no auth required to view)

PERSONAL (authenticated)
  /dashboard
  /project?id=[projectId]
  /document?id=[documentId]
  /manage-subscription

ORG (authenticated + org member)
  /org/[orgId]/repository    Knowledge Repository browse
  /org/[orgId]/chat          Enterprise Chat
  /org/[orgId]/departments   Department management
  /org/[orgId]/settings      Org settings (all members)
                             → Members tab (super_admin)
                             → Departments tab (super_admin)
                             → API Key tab (super_admin)
```

### API Route Map

```
ORGANIZATION
  POST   /api/org                           Create org
  GET    /api/org                           List user's orgs
  PATCH  /api/org/[orgId]/settings          Update name, API key

MEMBERS
  GET    /api/org/[orgId]/members           List members
  POST   /api/org/[orgId]/invite            Send invite
  GET    /api/org/invite/[token]            Validate invite
  POST   /api/org/invite/[token]/accept     Accept invite

DEPARTMENTS
  GET    /api/org/[orgId]/departments       List depts
  POST   /api/org/[orgId]/departments       Create dept
  POST   /api/org/[orgId]/departments/[id]/members   Add member
  DELETE /api/org/[orgId]/departments/[id]/members/[userId]

REPOSITORY
  GET    /api/org/[orgId]/repository        List repository docs (filtered)
  PATCH  /api/documents/[docId]/lifecycle   Update lifecycle state
  PATCH  /api/projects/[projectId]/scope    Promote project to org

ENTERPRISE CHAT
  POST   /api/org/[orgId]/chat              Streaming RAG chat
  GET    /api/org/[orgId]/chat/history      Past conversations
```

---

## 10. Org-Wide RAG Architecture

### Decision
A dedicated `orgSearch()` function in `src/lib/vectorSearch.js` handles org-wide retrieval. RBAC filtering is pushed into the SQL query — not done in application code after retrieval.

### Enterprise Chat Pipeline

```
User sends message to /org/[orgId]/chat
              │
              ▼
       1. Embed query
          (using org's OpenAI key)
              │
              ▼
       2. orgSearch(queryVec, userId, orgId)
              │
         ┌────┴────┐
         ▼         ▼
      Source A   Source B
      scope=     org-scoped
      repository projects
         │         │
         └────┬────┘
              ▼
       pgvector ANN query
       with RBAC in WHERE clause
              │
              ▼
       3. Top-K chunks returned
          (with doc name, dept)
              │
              ▼
       4. Build context prompt:
          "Using the following knowledge from
           your organization's repository..."
              │
              ▼
       5. Stream completion
          (using org's OpenAI key)
              │
              ▼
       6. Save OrgConversation + OrgMessage
              │
              ▼
       Response streamed to user
       with source citations:
       [Document Name → Department]
```

### Why RBAC in SQL, Not Application Code

```
❌ WRONG — Post-query filter
   1. Fetch top 100 chunks from DB (no RBAC)
   2. Filter down to chunks user can access
   3. May end up with 3 results after filtering
   → Wastes DB bandwidth
   → Inconsistent result counts
   → Risk of accidentally leaking chunk text before filtering

✅ CORRECT — RBAC in WHERE clause
   SELECT c.*, d.filename, dept.name
   FROM "Chunk" c
   JOIN "Document" d ON c."documentId" = d.id
   LEFT JOIN "Department" dept ON d."departmentId" = dept.id
   WHERE (
     -- Source A: repository docs user can access
     (d.scope = 'repository' AND d."orgId" = $orgId
      AND (d."departmentId" IS NULL
           OR d."departmentId" IN (user's dept IDs)))
     OR
     -- Source B: org-scoped project docs
     (d."projectId" IN (
        SELECT id FROM "Project"
        WHERE scope = 'org' AND "orgId" = $orgId
     ))
   )
   ORDER BY c.embedding <=> $queryVec
   LIMIT 20;
```

---

## 11. Document Lifecycle Management

### Decision
Documents in the Knowledge Repository have a lifecycle state. Only admins can change lifecycle. All states remain searchable (archived/retired docs are retrievable but deprioritized).

### Lifecycle States

```
         ┌──────────────────────────────────────────────────┐
         │                                                  │
         ▼                                                  │
       DRAFT                                                │
      (not yet                                              │
      searchable)                                           │
         │                                                  │
         │ publish                                          │
         ▼                                                  │
     PUBLISHED  ──── archive ────→  ARCHIVED               │
    (fully live,                   (searchable,             │
     searchable)                    lower priority)         │
         │                              │                   │
         │ retire                       │ retire            │
         ▼                              ▼                   │
      RETIRED ◄──────────────────── RETIRED                 │
    (searchable,                   (policy outdated,        │
     clearly marked                 keep for history)       │
     as outdated)                                           │
         │                                                  │
         └──────────── restore ──────────────────────────────┘
```

### Who Can Change Lifecycle

| Transition | Who |
|-----------|-----|
| draft → published | `super_admin`, `dept_admin` |
| published → archived | `super_admin`, `dept_admin` |
| archived → retired | `super_admin` only |
| retired → published | `super_admin` only |
| any → draft | `super_admin` only |

### UI Representation

```
Badge colors in Repository view:
  ● PUBLISHED  → green
  ● DRAFT      → amber / yellow
  ● ARCHIVED   → grey
  ● RETIRED    → red
```

---

## 12. Spreadsheet Ingestion Strategy

### Decision
Spreadsheets are processed as **a prerequisite** before the org repository launch. The `chunk` job in the worker is extended to handle `.xlsx/.xls/.csv` using SheetJS. Output chunks carry sheet metadata. The rest of the pipeline (embed → summarize) is unchanged.

### Spreadsheet Ingestion Flow

```
Upload .xlsx file
      │
      ▼
S3 storage (unchanged)
      │
      ▼
SQS chunk job
      │
      ▼
worker/index.js detects file type
      │
   ┌──┴──────────────────┐
   ▼                     ▼
PDF/text              xlsx/xls/csv
   │                     │
extractPdf.js        extractSpreadsheet.js (new)
   │                     │
   │               For each sheet:
   │                 ├── detect tables
   │                 ├── extract headers
   │                 └── produce row-chunks with metadata:
   │                     { workbookName, sheetName,
   │                       columnHeaders, rowRange }
   │                     │
   └────────────┬─────────┘
                ▼
           Chunks saved to DB
           (with metadata Json field)
                │
                ▼
         embed job (unchanged)
                │
                ▼
        summarize job (unchanged)
```

### Chunk Text Format for Spreadsheets

```
[Workbook: Q4_Sales_Report.xlsx | Sheet: Regional Sales]
Columns: Region, Q1 Revenue, Q2 Revenue, Q3 Revenue, Q4 Revenue

Row 2–11:
North America | $1.2M | $1.4M | $1.6M | $1.9M
Europe        | $0.8M | $0.9M | $1.1M | $1.3M
Asia Pacific  | $0.5M | $0.7M | $0.9M | $1.2M
...
```

This format ensures the LLM has full context for answering questions like:
- "Which region had the highest Q4 revenue?"
- "Compare Asia Pacific growth across quarters"

### Why Prerequisite (Not After)
Spreadsheets are explicitly listed as a supported document type in the Enterprise Repository requirements. Launching the repository without spreadsheet support would mean the feature is incomplete from day one — finance reports, KPI dashboards, and budget documents (all spreadsheets) are core enterprise knowledge assets.

---

## 13. Worker Pipeline — Minimal Changes

### Decision
The existing 3-stage worker pipeline is **preserved intact**. The only changes are: (1) file type routing in the `chunk` job, and (2) API key resolution.

### What Changes in the Worker

```
BEFORE
──────
chunk job:
  1. Download from S3
  2. extractPdf() → chunks
  3. Save chunks
  4. Enqueue embed job { userId }

embed job:
  1. Get user's openaiApiKey from Settings
  2. Generate embeddings
  3. Save as JSON
  4. Enqueue summarize job

summarize job:
  1. Get user's openaiApiKey from Settings
  2. Summarize chunks
  3. Mark document ready


AFTER (minimal diff)
────────────────────
chunk job:
  1. Download from S3
  2. ─── NEW: detect file type ───────────────────
  3.   PDF/text → extractPdf()                    │ only change
       xlsx/csv → extractSpreadsheet()  ──────────┘
  4. Save chunks (with metadata if spreadsheet)
  5. Enqueue embed job { userId, orgId? }  ← adds orgId

embed job:
  1. ─── NEW: resolve API key ────────────────────
       if orgId → org.openaiApiKey                │ only change
       else → user Setting key          ──────────┘
  2. Generate embeddings
  3. ─── NEW: save as vector (not JSON) ──────────┘ only change
  4. Enqueue summarize job

summarize job:
  1. ─── NEW: resolve API key (same logic) ───────┘ only change
  2. Summarize chunks
  3. Mark document ready
```

**What does NOT change:**
- Queue structure (same SQS queue, same job types)
- Chunk/embed/summarize sequence
- S3 storage pattern
- Document status state machine
- Error handling and retry logic

---

## Summary Table

| Decision | Choice | Key Reason |
|----------|--------|------------|
| Multi-tenancy | Organization above User | Clean isolation, natural RBAC, supports multiple org membership |
| Org creation | Any user, self-serve | Lowest friction, Slack model |
| RBAC | Two-level (org + dept) | Matches enterprise org structure |
| Document entity | Unified with scope field | Single pipeline, promotable docs, no code duplication |
| Project promotion | `scope` field on Project | No data migration, instant sharing |
| Vector storage | pgvector on Postgres | No new infra, scales to org-wide queries |
| Inference key | Org-level key | Predictable billing, works across multi-user context |
| Org switching | Sidebar switcher, URL-based | Familiar UX, shareable links, no session state |
| RAG RBAC | Pushed into SQL WHERE | No post-filter leaks, consistent result counts |
| Lifecycle | 4 states, admin-controlled | Keeps old knowledge accessible but clearly marked |
| Spreadsheet | Prerequisite, same pipeline | Core enterprise doc type, minimal pipeline change |
| Worker | Minimal diff only | Preserves stability of existing pipeline |
