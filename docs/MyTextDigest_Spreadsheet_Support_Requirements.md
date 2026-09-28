# My Text Digest - Spreadsheet File Support Requirements

## Feature Overview

**Feature Name:** Spreadsheet File Support

**Priority:** High

**Purpose:**
Enable organizations to upload, analyze, search, summarize, and chat with spreadsheet-based knowledge stored in Excel and CSV files.

---

# 1. Business Objective

Many small companies store critical operational knowledge in spreadsheets, including:

* Budgets
* Sales data
* Inventory records
* Project tracking
* Customer lists
* Forecasts
* KPI dashboards
* Reporting data

My Text Digest should treat spreadsheets as first-class knowledge assets alongside PDFs and text documents.

---

# 2. Supported File Types

### Initial Release

* `.xlsx` (Microsoft Excel)
* `.xls` (Legacy Excel)
* `.csv` (Comma-Separated Values)

### Workbook Support

* Single-sheet workbooks
* Multi-sheet workbooks

---

# 3. Core User Requirements

## Upload

Users must be able to:

* Upload spreadsheet files into projects.
* Store spreadsheets alongside PDFs and other supported documents.

## Ingestion

System must:

* Detect workbook structure.
* Identify sheet names.
* Extract data from all sheets.
* Preserve relationships between sheets where possible.

## Knowledge Management

Users must be able to:

* Generate spreadsheet summaries automatically.
* Ask questions about spreadsheet contents.
* Perform cross-sheet analysis.
* Search spreadsheet data semantically.
* Store spreadsheet knowledge in the same project knowledge base as other documents.

---

# 4. Knowledge Extraction Requirements

## Data Understanding

The ingestion pipeline should identify:

* Tables
* Column headers
* Row relationships
* Totals
* Metrics
* Structured datasets

## Context Preservation

Every extracted chunk should retain:

* Workbook name
* Sheet name
* Table name (if detected)
* Column headers
* Relevant row ranges

## Chunking Strategy

Spreadsheet data should be transformed into AI-readable chunks while preserving:

* Table structure
* Header relationships
* Data hierarchy
* Context needed for retrieval

---

# 5. AI Capabilities

The AI layer should support:

## Summarization

* Workbook-level summaries
* Sheet-level summaries

## Question Answering

Examples:

* "What were the top selling products?"
* "Which month had the highest revenue?"
* "Compare inventory across locations."

## Analytics

* Trend identification
* Key metric extraction
* Table explanation
* Cross-sheet comparison
* Natural language insights generation

---

# 6. User Experience Requirements

## Document Library

Spreadsheet files should appear in the same document library as:

* PDFs
* Text documents
* Other supported file types

## Summary Experience

Users should be able to:

* View generated summaries
* Navigate workbook summaries
* Navigate sheet summaries

## Chat Experience

Users should be able to:

* Chat with spreadsheet content
* Ask questions across sheets
* Receive contextual answers

## Source Attribution

Answers should identify:

* Workbook source
* Sheet source
* Table source (when applicable)

## Processing

Large spreadsheets should:

* Process asynchronously
* Display progress indicators
* Avoid blocking the user interface

---

# 7. Technical Considerations

## Spreadsheet Complexity

System should support:

* Large workbooks
* Multiple sheets
* Merged cells
* Missing values
* Inconsistent table formats
* Wide tables
* Long tables

## Metadata Storage

Store:

```json
{
  "workbookName": "",
  "sheetName": "",
  "tableName": "",
  "rowRange": "",
  "columnHeaders": []
}
```

## Retrieval Requirements

Retrieval should support:

* Workbook-level search
* Sheet-level search
* Cross-sheet search
* Semantic search
* Hybrid search (future)

---

# 8. Future Enhancements

## Visualization

* Spreadsheet visualization generation
* Automatic chart creation
* Downloadable chart images

## Formula Intelligence

* Formula understanding
* Formula explanation
* Formula dependency analysis

## Advanced Spreadsheet Support

* Pivot table interpretation
* Dashboard interpretation
* Financial model understanding

## Content Generation

* Spreadsheet-to-report generation
* Spreadsheet-to-presentation generation
* Spreadsheet-to-executive-summary generation

---

# Suggested Architecture (My Text Digest)

## Desktop Version

Ingestion Flow:

Spreadsheet Upload
→ Sheet Extraction
→ Table Detection
→ Chunk Generation
→ Embedding Generation
→ SQLite Storage
→ Retrieval & Chat

## Cloud Version

Ingestion Flow:

Spreadsheet Upload
→ Background Processing Worker
→ Sheet Extraction
→ Table Detection
→ Chunk Generation
→ Embedding Generation
→ Database Storage
→ Retrieval API
→ Chat Interface

---

# Success Criteria

A successful implementation allows a user to:

1. Upload Excel or CSV files.
2. Generate workbook and sheet summaries.
3. Ask natural-language questions about spreadsheet data.
4. Search spreadsheet content semantically.
5. Retrieve answers with workbook and sheet attribution.
6. Use spreadsheets alongside PDFs and other project documents within a unified knowledge repository.
