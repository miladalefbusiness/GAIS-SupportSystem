CREATE TABLE "knowledge_chunk_vectors" (
	"chunk_id" text PRIMARY KEY NOT NULL,
	"document_id" text NOT NULL,
	"document_version" integer DEFAULT 1 NOT NULL,
	"embedding_model" text NOT NULL,
	"dimensions" integer NOT NULL,
	"embedding" vector NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_qa_vectors" (
	"qa_entry_id" text PRIMARY KEY NOT NULL,
	"embedding_model" text NOT NULL,
	"dimensions" integer NOT NULL,
	"embedding" vector NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rag_evaluation_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"department_id" text,
	"run_label" text NOT NULL,
	"total_cases" integer DEFAULT 0 NOT NULL,
	"passed_cases" integer DEFAULT 0 NOT NULL,
	"recall_at_k" double precision DEFAULT 0 NOT NULL,
	"precision_at_k" double precision DEFAULT 0 NOT NULL,
	"mrr" double precision DEFAULT 0 NOT NULL,
	"ndcg" double precision DEFAULT 0 NOT NULL,
	"avg_latency_ms" integer DEFAULT 0 NOT NULL,
	"faithfulness_avg" double precision DEFAULT 0 NOT NULL,
	"answer_relevance_avg" double precision DEFAULT 0 NOT NULL,
	"citation_correctness_rate" double precision DEFAULT 0 NOT NULL,
	"abstention_accuracy_rate" double precision DEFAULT 0 NOT NULL,
	"unsupported_claim_rate" double precision DEFAULT 0 NOT NULL,
	"results_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"triggered_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rag_ingestion_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"document_id" text NOT NULL,
	"job_type" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"stage" text DEFAULT 'queued' NOT NULL,
	"target_version" integer DEFAULT 1 NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"total_chunks" integer DEFAULT 0 NOT NULL,
	"processed_chunks" integer DEFAULT 0 NOT NULL,
	"embedding_model" text,
	"error_code" text,
	"error_message" text,
	"payload_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"triggered_by_user_id" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tickets" DROP CONSTRAINT "tickets_customer_profile_id_customer_profiles_id_fk";
--> statement-breakpoint
ALTER TABLE "ai_conversations" ADD COLUMN "customer_profile_id" text;--> statement-breakpoint
ALTER TABLE "ai_messages" ADD COLUMN "response_outcome" text;--> statement-breakpoint
ALTER TABLE "ai_messages" ADD COLUMN "citations_json" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_provider_settings" ADD COLUMN "reranker_mode" text DEFAULT 'cross_feature' NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_provider_settings" ADD COLUMN "reranker_endpoint_url" text;--> statement-breakpoint
ALTER TABLE "ai_provider_settings" ADD COLUMN "crag_max_iterations" integer DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_provider_settings" ADD COLUMN "crag_max_model_calls" integer DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_provider_settings" ADD COLUMN "crag_enable_llm_judge" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_provider_settings" ADD COLUMN "enable_llm_query_transform" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "customer_profiles" ADD COLUMN "password_hash" text;--> statement-breakpoint
ALTER TABLE "customer_profiles" ADD COLUMN "password_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ADD COLUMN "document_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ADD COLUMN "parent_chunk_id" text;--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ADD COLUMN "chunk_level" text DEFAULT 'child' NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ADD COLUMN "heading_path" text;--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ADD COLUMN "section_title" text;--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ADD COLUMN "page_number" integer;--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ADD COLUMN "sheet_name" text;--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ADD COLUMN "chunk_type" text DEFAULT 'text' NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ADD COLUMN "classification" text DEFAULT 'department' NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ADD COLUMN "source_ref" text;--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ADD COLUMN "is_active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ADD COLUMN "embedding_model" text;--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ADD COLUMN "embedding_dimensions" integer;--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ADD COLUMN "search_tsv" "tsvector";--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ADD COLUMN "indexed_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_documents" ADD COLUMN "classification" text DEFAULT 'department' NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_documents" ADD COLUMN "ingestion_stage" text DEFAULT 'completed' NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_documents" ADD COLUMN "validity_status" text DEFAULT 'current' NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_documents" ADD COLUMN "superseded_by_doc_id" text;--> statement-breakpoint
ALTER TABLE "knowledge_documents" ADD COLUMN "effective_from" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "knowledge_documents" ADD COLUMN "effective_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "knowledge_documents" ADD COLUMN "embedding_model_used" text;--> statement-breakpoint
ALTER TABLE "knowledge_documents" ADD COLUMN "embedding_dimensions" integer;--> statement-breakpoint
ALTER TABLE "knowledge_qa_entries" ADD COLUMN "embedding_model" text;--> statement-breakpoint
ALTER TABLE "knowledge_qa_entries" ADD COLUMN "embedding_dimensions" integer;--> statement-breakpoint
ALTER TABLE "knowledge_qa_entries" ADD COLUMN "search_tsv" "tsvector";--> statement-breakpoint
ALTER TABLE "knowledge_retrieval_records" ADD COLUMN "trace_json" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_chunk_vectors" ADD CONSTRAINT "knowledge_chunk_vectors_chunk_id_knowledge_chunks_id_fk" FOREIGN KEY ("chunk_id") REFERENCES "public"."knowledge_chunks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_chunk_vectors" ADD CONSTRAINT "knowledge_chunk_vectors_document_id_knowledge_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."knowledge_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_qa_vectors" ADD CONSTRAINT "knowledge_qa_vectors_qa_entry_id_knowledge_qa_entries_id_fk" FOREIGN KEY ("qa_entry_id") REFERENCES "public"."knowledge_qa_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rag_evaluation_runs" ADD CONSTRAINT "rag_evaluation_runs_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rag_evaluation_runs" ADD CONSTRAINT "rag_evaluation_runs_triggered_by_user_id_users_id_fk" FOREIGN KEY ("triggered_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rag_ingestion_jobs" ADD CONSTRAINT "rag_ingestion_jobs_document_id_knowledge_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."knowledge_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rag_ingestion_jobs" ADD CONSTRAINT "rag_ingestion_jobs_triggered_by_user_id_users_id_fk" FOREIGN KEY ("triggered_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "kb_chunk_vecs_doc_active_idx" ON "knowledge_chunk_vectors" USING btree ("document_id","is_active");--> statement-breakpoint
CREATE INDEX "kb_chunk_vecs_model_dim_idx" ON "knowledge_chunk_vectors" USING btree ("embedding_model","dimensions","is_active");--> statement-breakpoint
CREATE INDEX "kb_qa_vecs_model_dim_idx" ON "knowledge_qa_vectors" USING btree ("embedding_model","dimensions","is_active");--> statement-breakpoint
CREATE INDEX "rag_eval_runs_created_idx" ON "rag_evaluation_runs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "rag_eval_runs_dept_idx" ON "rag_evaluation_runs" USING btree ("department_id","created_at");--> statement-breakpoint
CREATE INDEX "rag_jobs_status_created_idx" ON "rag_ingestion_jobs" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "rag_jobs_doc_created_idx" ON "rag_ingestion_jobs" USING btree ("document_id","created_at");--> statement-breakpoint
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_customer_profile_id_customer_profiles_id_fk" FOREIGN KEY ("customer_profile_id") REFERENCES "public"."customer_profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_customer_profile_id_customer_profiles_id_fk" FOREIGN KEY ("customer_profile_id") REFERENCES "public"."customer_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_conversations_customer_idx" ON "ai_conversations" USING btree ("customer_profile_id");--> statement-breakpoint
CREATE INDEX "kb_chunks_active_level_idx" ON "knowledge_chunks" USING btree ("document_id","is_active","chunk_level");--> statement-breakpoint
CREATE INDEX "kb_chunks_parent_idx" ON "knowledge_chunks" USING btree ("parent_chunk_id");--> statement-breakpoint
CREATE INDEX "kb_chunks_search_tsv_gin_idx" ON "knowledge_chunks" USING gin ("search_tsv");--> statement-breakpoint
CREATE INDEX "kb_docs_validity_idx" ON "knowledge_documents" USING btree ("validity_status","is_enabled");--> statement-breakpoint
CREATE INDEX "kb_qa_search_tsv_gin_idx" ON "knowledge_qa_entries" USING gin ("search_tsv");