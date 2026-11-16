CREATE TABLE "ai_conversations" (
	"id" text PRIMARY KEY NOT NULL,
	"department_id" text NOT NULL,
	"mode" text DEFAULT 'ai_assisted' NOT NULL,
	"escalated_to_human" boolean DEFAULT false NOT NULL,
	"handoff_requested_at" timestamp with time zone,
	"handoff_reason" text,
	"ai_auto_reply_enabled" boolean DEFAULT true NOT NULL,
	"turn_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_department_settings" (
	"department_id" text PRIMARY KEY NOT NULL,
	"ai_enabled" boolean DEFAULT true NOT NULL,
	"welcome_message_fa" text DEFAULT '' NOT NULL,
	"fallback_message_fa" text DEFAULT 'برای پاسخ دقیق به این سؤال، اطلاعات تأییدشده‌ای در مخزن دانش سازمان پیدا نشد. می‌توانید درخواست خود را به اپراتور مربوطه ارجاع دهید.' NOT NULL,
	"auto_offer_escalation" boolean DEFAULT true NOT NULL,
	"min_confidence_score" integer DEFAULT 25 NOT NULL,
	"max_turns_per_session" integer DEFAULT 20 NOT NULL,
	"allow_ai_during_human_handoff" boolean DEFAULT false NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"sender_role" text NOT NULL,
	"content" text NOT NULL,
	"abstained" boolean DEFAULT false NOT NULL,
	"escalation_offered" boolean DEFAULT false NOT NULL,
	"retrieval_confidence" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_provider_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"provider_type" text DEFAULT 'gemini' NOT NULL,
	"provider_name" text DEFAULT 'Google Gemini' NOT NULL,
	"base_url" text,
	"encrypted_api_key" text,
	"api_key_hint" text,
	"chat_model" text DEFAULT 'gemini-4-hydrogen' NOT NULL,
	"embedding_model" text,
	"timeout_ms" integer DEFAULT 25000 NOT NULL,
	"max_output_tokens" integer DEFAULT 1024 NOT NULL,
	"temperature" text DEFAULT '0.1' NOT NULL,
	"global_enabled" boolean DEFAULT false NOT NULL,
	"last_tested_at" timestamp with time zone,
	"last_test_ok" boolean,
	"last_test_message" text,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_usage_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"department_id" text,
	"conversation_id" text,
	"provider_type" text NOT NULL,
	"model_name" text NOT NULL,
	"status" text NOT NULL,
	"latency_ms" integer DEFAULT 0 NOT NULL,
	"prompt_tokens" integer,
	"completion_tokens" integer,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "department_knowledge_collections" (
	"department_id" text NOT NULL,
	"collection_id" text NOT NULL,
	"assigned_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "department_knowledge_collections_department_id_collection_id_pk" PRIMARY KEY("department_id","collection_id")
);
--> statement-breakpoint
CREATE TABLE "knowledge_chunks" (
	"id" text PRIMARY KEY NOT NULL,
	"document_id" text NOT NULL,
	"chunk_index" integer NOT NULL,
	"content" text NOT NULL,
	"normalized_content" text NOT NULL,
	"token_estimate" integer DEFAULT 0 NOT NULL,
	"metadata_json" jsonb,
	"embedding_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_collections" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name_fa" text NOT NULL,
	"description_fa" text DEFAULT '' NOT NULL,
	"scope" text DEFAULT 'department' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_document_departments" (
	"document_id" text NOT NULL,
	"department_id" text NOT NULL,
	CONSTRAINT "knowledge_document_departments_document_id_department_id_pk" PRIMARY KEY("document_id","department_id")
);
--> statement-breakpoint
CREATE TABLE "knowledge_document_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"document_id" text NOT NULL,
	"version" integer NOT NULL,
	"original_filename" text NOT NULL,
	"storage_key" text NOT NULL,
	"byte_size" bigint NOT NULL,
	"sha256" text NOT NULL,
	"status" text NOT NULL,
	"error_message" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_documents" (
	"id" text PRIMARY KEY NOT NULL,
	"collection_id" text,
	"title_fa" text NOT NULL,
	"original_filename" text NOT NULL,
	"storage_key" text NOT NULL,
	"mime_type" text NOT NULL,
	"file_extension" text NOT NULL,
	"byte_size" bigint NOT NULL,
	"sha256" text NOT NULL,
	"scope" text DEFAULT 'department' NOT NULL,
	"status" text DEFAULT 'uploaded' NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"extracted_text" text,
	"chunk_count" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"last_indexed_at" timestamp with time zone,
	"uploaded_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_qa_departments" (
	"qa_entry_id" text NOT NULL,
	"department_id" text NOT NULL,
	CONSTRAINT "knowledge_qa_departments_qa_entry_id_department_id_pk" PRIMARY KEY("qa_entry_id","department_id")
);
--> statement-breakpoint
CREATE TABLE "knowledge_qa_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"collection_id" text,
	"question" text NOT NULL,
	"alternative_questions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"official_answer" text NOT NULL,
	"category" text DEFAULT 'عمومی' NOT NULL,
	"keywords" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"scope" text DEFAULT 'department' NOT NULL,
	"status" text DEFAULT 'published' NOT NULL,
	"normalized_search_text" text NOT NULL,
	"embedding_json" jsonb,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_retrieval_records" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"message_id" text NOT NULL,
	"department_id" text NOT NULL,
	"query_text" text NOT NULL,
	"sources_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"top_score" integer DEFAULT 0 NOT NULL,
	"abstained" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_department_settings" ADD CONSTRAINT "ai_department_settings_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_department_settings" ADD CONSTRAINT "ai_department_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_messages" ADD CONSTRAINT "ai_messages_conversation_id_ai_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."ai_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_provider_settings" ADD CONSTRAINT "ai_provider_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage_logs" ADD CONSTRAINT "ai_usage_logs_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "department_knowledge_collections" ADD CONSTRAINT "department_knowledge_collections_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "department_knowledge_collections" ADD CONSTRAINT "department_knowledge_collections_collection_id_knowledge_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."knowledge_collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "department_knowledge_collections" ADD CONSTRAINT "department_knowledge_collections_assigned_by_users_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_document_id_knowledge_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."knowledge_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_collections" ADD CONSTRAINT "knowledge_collections_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_document_departments" ADD CONSTRAINT "knowledge_document_departments_document_id_knowledge_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."knowledge_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_document_departments" ADD CONSTRAINT "knowledge_document_departments_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_document_versions" ADD CONSTRAINT "knowledge_document_versions_document_id_knowledge_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."knowledge_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_document_versions" ADD CONSTRAINT "knowledge_document_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_documents" ADD CONSTRAINT "knowledge_documents_collection_id_knowledge_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."knowledge_collections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_documents" ADD CONSTRAINT "knowledge_documents_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_qa_departments" ADD CONSTRAINT "knowledge_qa_departments_qa_entry_id_knowledge_qa_entries_id_fk" FOREIGN KEY ("qa_entry_id") REFERENCES "public"."knowledge_qa_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_qa_departments" ADD CONSTRAINT "knowledge_qa_departments_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_qa_entries" ADD CONSTRAINT "knowledge_qa_entries_collection_id_knowledge_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."knowledge_collections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_qa_entries" ADD CONSTRAINT "knowledge_qa_entries_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_retrieval_records" ADD CONSTRAINT "knowledge_retrieval_records_conversation_id_ai_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."ai_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_retrieval_records" ADD CONSTRAINT "knowledge_retrieval_records_message_id_ai_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."ai_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_retrieval_records" ADD CONSTRAINT "knowledge_retrieval_records_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_conversations_dept_idx" ON "ai_conversations" USING btree ("department_id");--> statement-breakpoint
CREATE INDEX "ai_conversations_mode_idx" ON "ai_conversations" USING btree ("mode");--> statement-breakpoint
CREATE INDEX "ai_messages_conv_idx" ON "ai_messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_usage_logs_dept_idx" ON "ai_usage_logs" USING btree ("department_id");--> statement-breakpoint
CREATE INDEX "ai_usage_logs_created_idx" ON "ai_usage_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "dept_kb_collections_dept_idx" ON "department_knowledge_collections" USING btree ("department_id");--> statement-breakpoint
CREATE INDEX "kb_chunks_doc_idx" ON "knowledge_chunks" USING btree ("document_id","chunk_index");--> statement-breakpoint
CREATE UNIQUE INDEX "kb_collections_slug_unique_idx" ON "knowledge_collections" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "kb_collections_scope_idx" ON "knowledge_collections" USING btree ("scope","is_active");--> statement-breakpoint
CREATE INDEX "kb_doc_depts_dept_idx" ON "knowledge_document_departments" USING btree ("department_id");--> statement-breakpoint
CREATE INDEX "kb_doc_versions_doc_idx" ON "knowledge_document_versions" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "kb_docs_collection_idx" ON "knowledge_documents" USING btree ("collection_id");--> statement-breakpoint
CREATE INDEX "kb_docs_status_idx" ON "knowledge_documents" USING btree ("status","is_enabled");--> statement-breakpoint
CREATE INDEX "kb_docs_scope_idx" ON "knowledge_documents" USING btree ("scope");--> statement-breakpoint
CREATE INDEX "kb_qa_depts_dept_idx" ON "knowledge_qa_departments" USING btree ("department_id");--> statement-breakpoint
CREATE INDEX "kb_qa_status_scope_idx" ON "knowledge_qa_entries" USING btree ("status","scope");--> statement-breakpoint
CREATE INDEX "kb_qa_collection_idx" ON "knowledge_qa_entries" USING btree ("collection_id");--> statement-breakpoint
CREATE INDEX "kb_retrieval_conv_idx" ON "knowledge_retrieval_records" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "kb_retrieval_dept_idx" ON "knowledge_retrieval_records" USING btree ("department_id");