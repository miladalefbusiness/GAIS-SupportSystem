# Stage 1 — Enterprise RAG Architecture Audit & Staged Implementation Plan

## 1. Purpose & Scope

This document completes **Stage 1 (Audit and Architecture)** for upgrading the Helpdesk application's AI and Knowledge Base backend into a production-oriented **Advanced Enterprise RAG Engine**, functionally inspired by **Qragy** (`https://github.com/mahsumaktas/qragy`) while built independently on the existing **Next.js 15 App Router + TypeScript strict + PostgreSQL 18.6 + Drizzle ORM** Helpdesk foundation.

---

## 2. Qragy Repository Inspection & License Audit

### 2.1 License Determination
- **License**: **GNU Affero General Public License v3.0 (`AGPL-3.0`)** (verified from repository root `LICENSE`).
- **Engineering Decision**: Because AGPL-3.0 imposes strong network-copyleft obligations that conflict with closed/commercial organizational distribution without source-disclosure requirements, **zero Qragy source code is copied or reused**. All modules, schemas, prompts, retrieval algorithms, CRAG controllers, verifiers, and evaluation suites are designed and implemented **100% independently** as original TypeScript code native to this Helpdesk architecture.

### 2.2 Qragy Capability Audit (Implemented vs. Experimental / Lightweight vs. Described)

| Capability Area | Actually Implemented in Qragy | Experimental / Lightweight / Heuristic in Qragy | Described / Architectural Limitations vs. Our Enterprise Needs |
| :--- | :--- | :--- | :--- |
| **Runtime & Storage** | Single-process Node.js (CommonJS) using SQLite (`better-sqlite3`) + embedded **LanceDB** + CSV/Markdown files on disk | `jobQueue.js` polling SQLite table in-process | Not PostgreSQL/Drizzle; no relational RBAC, no multi-department isolation, no document versioning/parent-child chunks, not Next.js App Router |
| **Document Ingestion** | CSV Q&A + PDF/DOCX/XLSX/TXT upload + URL extractor (`urlExtractor.js`) + `contextualChunker.js` (LLM summary prepend) | Chunk provenance is minimal (no strict section hierarchy, table serialization rules, or page-level citations per chunk) | Needs structured extraction preserving headings/sections/tables/page numbers, Persian text normalization, status workflow, and stale-chunk cleanup |
| **Retrieval Engine** | `searchEngine.js` (LanceDB vector + SQLite FTS5 BM25 + Reciprocal Rank Fusion + adaptive `topK` by KB size: 3/5/7) | Simple heuristics for KB size; lacks strict embedding-model compatibility guard across indexed chunks | Needs DB-backed embedding version/model tracking, parent-child section expansion, query decomposition + multi-query + expansion + conversation contextualization |
| **Query Analysis & Adaptive Routing** | `queryAnalyzer.js` classifying `simple/medium/complex` + `intent` + `subQueries` + `standaloneQuery`; `chatPipeline.js` (`FAST` / `STANDARD` / `DEEP`) | `FAST` path bypasses KB retrieval directly to LLM (risky for strict organizational policy compliance) | Enterprise Helpdesk must never answer org policy/procedures without authorized evidence; `FAST` must still apply lexical/exact Q&A or safe conversational boundary |
| **Reranking** | `reranker.js` (Cohere `rerank-v3.5` → LLM-as-reranker → RRF score fallback) | Relies on hardcoded external Cohere endpoint or uncalibrated LLM integer prompt | Needs provider-agnostic replaceable `RerankerAdapter` (Cross-Encoder HTTP, LLM-based, Deterministic feature/BM25+semantic reranker) with score traces |
| **Corrective RAG (CRAG)** | `cragEvaluator.js` classifies results as `RELEVANT / PARTIAL / IRRELEVANT`, rewrites query up to `MAX_REWRITE_ATTEMPTS = 2` | Binary/3-way verdict per result without explicit multi-criteria checks (currency/superseded status, numeric contradiction, doc authorization) | Needs full 6-dimension evidence evaluation (relevance, sufficiency, consistency, authorization, currency/superseded, specificity) + bounded corrective actions (rewrite, expand, decompose, parent-expand) + strict iteration/call/time caps |
| **Verification & Self-Correction** | `qualityScorer.js` (RAGAS-style LLM faithfulness/relevancy JSON) + `reflexion.js` (negative feedback post-mortem) | Post-hoc scoring; citation validity against actual returned chunks is basic (`citation.test.js` / `responseValidator.js`) | Needs synchronous **pre-delivery claim-to-evidence verification & citation validation** so fabricated citations or unsupported claims are caught and downgraded/abstained before display |
| **Memory & Knowledge Graph** | `coreMemory.js` / `recallMemory.js` / `graphBuilder.js` (SQLite entity/relation extraction from closed tickets) | Experimental/heuristic LLM extraction (`product/branch/issue_type`) | Out of scope to replace KB authorization; our Helpdesk uses ticket history + department KB isolation rather than cross-user graph inference |
| **Security & Guards** | Regex `injectionGuard.js` + LLM off-topic check + PII masking in logs | Single-tenant bot; no multi-department collection ACLs or Super Admin vs Operator RBAC | Already superseded in parts by our RBAC/department scoping, AES-256-GCM key storage, and audit logs; needs untrusted-document indirect prompt-injection defense and pre-retrieval ACL SQL filtering |
| **Evaluation** | `tests/eval/` (`scenarios.json` + rule-based `judge.js` + SSE runner) | Rule-based substring matching (`shouldContainAny`/`shouldNotContain`); LLM-as-judge noted as future comment (`judge.js` line 7) | Needs formal IR + RAG metrics (`Recall@K`, `Precision@K`, `MRR`, `nDCG`, latency, faithfulness, answer relevance, citation correctness, abstention correctness, unsupported claim rate) + persisted baseline comparison in PostgreSQL |

---

## 3. Audit of Existing Helpdesk AI & Knowledge Base Implementation

### 3.1 Existing Assets Found
- **Database Schema (`src/db/schema.ts`, Cloud SQL PostgreSQL 18.6)**:
  - `knowledge_collections`, `department_knowledge_collections`
  - `knowledge_documents`, `knowledge_document_versions`, `knowledge_document_departments`
  - `knowledge_chunks` (currently stores `content`, `normalizedContent`, `metadataJson`, `embeddingJson` as JSONB `number[] | null`)
  - `knowledge_qa_entries`, `knowledge_qa_departments`
  - `ai_provider_settings` (AES-256-GCM encrypted API key, `gemini` & `openai_compatible`), `ai_department_settings`
  - `ai_conversations`, `ai_messages`, `knowledge_retrieval_records`, `ai_usage_logs`
  - Full Ticketing & Handoff link (`tickets.linkedAiConversationId` in `src/modules/tickets/service.ts` preserving chronological AI turns on handoff).
- **Cloud SQL PostgreSQL 18.6 Extensions Verified**:
  - `vector` (`0.8.5`), `pg_trgm` (`1.6`), and `unaccent` (`1.1`) are **available** on the Cloud SQL instance (`installed_version: null` → ready to enable via `CREATE EXTENSION IF NOT EXISTS`).
- **Existing Code Modules**:
  - `src/modules/ai/provider.ts`: `GeminiProviderAdapter` (`@google/genai`, Gemini 4 `ThinkingLevel.LOW` compliant) & `OpenAiCompatibleAdapter` (`fetch`).
  - `src/modules/ai/chat.ts`: Customer message persistence, handoff guard, turn limit, basic prompt-injection regex, single-pass retrieval, conflict abstain check, strict XML-delimited grounding prompt (`ABSTAIN_INSUFFICIENT_CONTEXT`, `ABSTAIN_CONFLICTING_SOURCES`), and usage/retrieval logging.
  - `src/modules/knowledge/extractor.ts`: Supports `pdf` (`unpdf` with `mergePages: true` — discards page numbers), `docx` (`mammoth`), `txt`, `md`. **No `xlsx` yet.**
  - `src/modules/knowledge/text.ts`: Persian character/digit normalization (`normalizePersianText`), stopword tokenizer, paragraph+fixed-char chunker (`chunkDocumentText`), in-JS cosine similarity & overlap scorer (`scoreTextRelevance`).
  - `src/modules/knowledge/retrieval.ts`: Loads **all** authorized Q&As and chunks into Node.js memory and scores linearly in JS; basic numeric-difference conflict detector.

### 3.2 Critical Gap Analysis

| Domain | Current Gap | Target Enterprise Requirement |
| :--- | :--- | :--- |
| **Ingestion & Formats** | No `.xlsx` support; PDF `mergePages: true` throws away page numbers; synchronous inline upload blocks request thread; no structural heading/section/table parsing or parent-child chunk hierarchy | Async DB-backed background job worker (`rag_ingestion_jobs`), PDF page preservation, DOCX/MD heading hierarchy, XLSX sheet/row structured tables, parent-child chunk links (`parentChunkId`, `chunkLevel`), full provenance (`documentId`, `version`, `pageNumber`, `sectionPath`, `heading`, `chunkSequence`, `classification`, `indexedAt`) |
| **Indexing & Vector Storage** | `embeddingJson` JSONB scanned linearly in Node.js; no `pgvector` HNSW/IVFFlat index; no FTS `tsvector`/GIN index; silent failure/skip if embedding model changes | `VectorStoreAdapter` abstraction with **PostgreSQL `pgvector`** implementation + **PostgreSQL FTS (`tsvector` + `pg_trgm`)** lexical engine + `embeddingModel` & `embeddingDimensions` tracking per index/chunk preventing cross-model vector comparison |
| **Retrieval Pipeline** | Single-pass heuristic keyword+cosine sum; no RRF; no query rewriting/decomposition/multi-query/conversation contextualization; no adaptive strategy selection; no reranker | Modular pipeline: Query Transformer (contextualize, normalize, rewrite, expand, decompose) → Adaptive Strategy Selector → Lexical + Vector + Hybrid **RRF** → Parent-Child context expansion → Pluggable `RerankerAdapter` |
| **Corrective RAG (CRAG)** | No post-retrieval sufficiency/currency/consistency evaluator; no bounded retry loop | Dedicated `CragController` evaluating 6 dimensions → `RELEVANT` / `AMBIGUOUS` / `INSUFFICIENT` with bounded corrective cycles (max iterations, max model calls, timeout budget) & safe internal escalation |
| **Generation & Verification** | Single LLM output check for 2 magic tokens; no citation extraction, citation validation, claim-level verification, or structured `answerStatus` | Grounded generator enforcing strict `<evidence>` citations (`[S1]`, doc/page/section), followed by `AnswerVerifier` checking claim grounding + valid source IDs + doc currency, returning structured `ChatRagResult` |
| **Helpdesk UX & Ops** | Customer chat shows plain text + abstention banner (no source citations/section refs, no clarify/status badges); Handoff copies `ai_messages` without retrieval/CRAG diagnostic summary for operators; no evaluation dataset/metrics suite | Structured RAG trace + source citations in customer chat & operator ticket handoff internal summary; Admin controls for RAG strategy/CRAG/reranker settings, chunk/index diagnostics, and reproducible Evaluation Runner with all 8 required benchmark categories |

---

## 4. Target Modular Architecture

All new RAG engine capabilities live inside a cohesive backend module **`src/modules/rag/`** wired cleanly into `src/modules/knowledge/`, `src/modules/ai/`, `src/modules/tickets/`, and existing Drizzle PostgreSQL tables (no duplicate users, departments, auth, or ticket engines).

```text
src/modules/rag/
├── types.ts                  # Shared provenance, trace, CRAG, verification, & eval contracts
├── normalizer.ts             # Enhanced Persian/Unicode normalization, code/ID/date/acronym extraction
├── chunking/
│   ├── structured-parser.ts  # Format-aware extraction (PDF pages, DOCX/MD headings, XLSX sheets/tables)
│   └── parent-child.ts       # Hierarchical section (parent) + precise retrieval (child) chunker
├── jobs/
│   └── ingestion-worker.ts   # PostgreSQL-backed durable ingestion & re-index job processor
├── stores/
│   ├── interfaces.ts         # VectorStoreAdapter, LexicalSearchAdapter, RerankerAdapter
│   ├── pg-lexical.ts         # PostgreSQL FTS (tsvector) + pg_trgm + exact identifier/phrase matcher
│   ├── pg-vector.ts          # pgvector cosine similarity store with model/version safety guard
│   └── memory-fallback.ts    # Pure TS fallback adapter for unit tests without DB vector extension
├── retrieval/
│   ├── query-transformer.ts  # Normalization, contextualization, rewrite, expansion, decomposition
│   ├── strategy-selector.ts  # Adaptive strategy (lexical | semantic | hybrid | multi_query | decompose | iterative)
│   ├── rrf.ts                # Reciprocal Rank Fusion + configurable weights/thresholds
│   ├── parent-expander.ts    # Expands child chunks with parent section & neighbor chunks
│   └── reranker.ts           # Deterministic cross-feature reranker + optional LLM/HTTP cross-encoder reranker
├── crag/
│   └── controller.ts         # 6-criteria evidence evaluator + bounded corrective retrieval loop
├── generation/
│   ├── generator.ts          # Grounded response synthesis with structured source citations & prompt-injection guard
│   └── verifier.ts           # Claim extraction/verification, citation validation, conflict/version guard
├── evaluation/
│   ├── metrics.ts            # Recall@K, Precision@K, MRR, nDCG, latency, faithfulness, citation & abstention accuracy
│   └── runner.ts             # Reproducible evaluation runner across 8 dataset categories
└── orchestrator.ts           # Unified entry point consumed by Helpdesk chat & admin retrieval sandbox
```

### Key Architectural Invariants
1. **Authorization Before LLM (Zero-Leakage Pre-Filtering)**: Access control (`scope IN ('global','department')` + department/collection ACL + `status = 'indexed'` + `isEnabled = true` + `isCurrent = true`, strictly excluding `restricted` and superseded versions) is enforced **inside SQL `WHERE` clauses** on every lexical, vector, and parent-expansion query *before* chunks ever enter reranking, CRAG, or generation.
2. **Embedding Model Safety**: `knowledge_chunk_vectors` (or chunk embedding metadata) stores `embeddingModel` and `dimensions`. Semantic search filters strictly by the **active `embeddingModel` + `dimensions`**; mismatched documents trigger explicit admin re-embedding alerts and degrade safely to lexical retrieval instead of comparing incompatible vector spaces.
3. **Untrusted Document Isolation**: Uploaded files and retrieved passages are sanitized and wrapped inside strict XML boundaries with explicit system instructions prohibiting instruction following from document text.
4. **No Public Web Search / Parametric Fallback**: Organizational answers rely strictly on authorized internal knowledge; bounded CRAG retries stay strictly within authorized internal collections before abstaining and offering human operator escalation.
5. **Zero Extra Infrastructure**: Uses existing Cloud SQL PostgreSQL 18.6 (`pgvector`, `pg_trgm`, FTS `tsvector`), existing storage driver (`local` / `s3`), and existing `AiProviderAdapter`.

---

## 5. Planned Schema Additions (Stage 2–7)

Using Drizzle ORM (`src/db/schema.ts`) + `cloudsql.UpdateSchema` (and `CREATE EXTENSION IF NOT EXISTS vector; CREATE EXTENSION IF NOT EXISTS pg_trgm;` via `cloudsql.ExecuteSql`):

- **`knowledge_documents` extensions**: `activeVersion` alignment, `classification` (`public_org | department | internal_restricted`), `validityStatus` (`current | superseded | expired`), `supersededByDocId`, `effectiveFrom`, `effectiveUntil`, `embeddingModelUsed`, `ingestionStatus`.
- **`knowledge_chunks` extensions**: `documentVersion`, `parentChunkId`, `chunkLevel` (`parent | child`), `headingPath` (`text`), `sectionTitle` (`text`), `pageNumber` (`integer`), `sheetName` (`text`), `chunkType` (`text | table | list | qa`), `classification`, `isActive` (`boolean`), `embeddingModel`, `embeddingDimensions`, `embeddingVector` (`vector` or dedicated `knowledge_chunk_vectors` table supporting heterogeneous dimensions safely), `searchTsv` (`tsvector` indexed via GIN).
- **`rag_ingestion_jobs`**: Durable job queue (`id`, `documentId`, `jobType`, `status`, `attempts`, `maxAttempts`, `stage`, `errorCode`, `errorMessage`, `startedAt`, `completedAt`, `createdAt`).
- **`rag_engine_settings`**: Configurable retrieval parameters (`defaultStrategy`, `rrfK`, `lexicalWeight`, `semanticWeight`, `candidateLimit`, `finalContextLimit`, `rerankerMode`, `cragMaxIterations`, `cragMaxModelCalls`, `cragTimeoutMs`, `strictVerification`, `minEvidenceScore`).
- **`knowledge_retrieval_records` / `ai_messages` extensions**: Structured `answerStatus`, `retrievalStrategy`, `transformedQueriesJson`, `rerankUsed`, `cragDecision`, `correctiveActionsJson`, `verificationJson`, `citationsJson`, `humanEscalationRecommended`.
- **`rag_eval_datasets`, `rag_eval_cases`, `rag_eval_runs`, `rag_eval_results`**: Persisted evaluation benchmarks across all 8 required test categories and historical baseline comparisons.

---

## 6. Controlled Staged Implementation Roadmap

| Stage | Scope | Key Deliverables | Verification Gate |
| :--- | :--- | :--- | :--- |
| **Stage 1** *(Done)* | Audit & Architecture | Inspect codebase, Cloud SQL extensions, Qragy license/capabilities; produce `docs/RAG-ARCHITECTURE-AUDIT.md` | Audit reviewed; no regressions |
| **Stage 2** | Ingestion & Indexing | Enable `pgvector` + `pg_trgm`; Drizzle schema migration; `XLSX` + page-aware PDF/DOCX/MD extractors; Persian normalizer; parent-child structure-aware chunker; durable background ingestion worker; versioning + stale chunk deactivation | Unit + PostgreSQL integration tests for all 5 formats, versioning, stale cleanup, and Persian text |
| **Stage 3** | Advanced Retrieval & Reranking | `pg_lexical` (FTS + `pg_trgm` + exact codes/dates) + `pg_vector` (model-safe) + RRF hybrid fusion + Query Transformer (6 transforms + trace) + Parent-Child expansion + Adaptive strategy selector + Reranker layer | Unit + DB integration tests for RRF, model mismatch safety, query transforms, parent expansion, adaptive routing |
| **Stage 4** | Corrective RAG (CRAG) | 6-dimension evidence evaluator (`Relevant` / `Ambiguous` / `Insufficient`), bounded corrective loop (rewrite, decompose, expand, retry), strict caps (iterations, time, calls), zero external web fallback | Tests for relevant direct pass, ambiguous rewrite/expand recovery, insufficient abstention, infinite-loop cap |
| **Stage 5** | Grounded Generation & Verification | Strict grounded synthesizer with document/page/section citations, claim-level verifier, citation validator, conflicting/superseded version resolver, indirect document prompt-injection defense | Tests for hallucination/unsupported-claim blocking, invalid citation rejection, conflict/outdated handling, indirect injection |
| **Stage 6** | Helpdesk Integration | Wire `rag/orchestrator.ts` into `handleCustomerAiMessage`, public chat API, `DepartmentChatDialog.tsx` (citations + status/clarify/escalate), and `convertAiConversationToTicket` (transfer retrieval & verification history to operators) | E2E workflow tests + existing Phase 1–7 suite green |
| **Stage 7** | Evaluation, Observability & Admin UI | Built-in 8-category Persian/English eval suite (`Recall@K`, `Precision@K`, `MRR`, `nDCG`, faithfulness, citation/abstention accuracy, unsupported claim rate), Admin RAG Settings + Eval Runner + Retrieval Trace Explorer | All **12 Acceptance Scenarios** + `npm run check` passing |
