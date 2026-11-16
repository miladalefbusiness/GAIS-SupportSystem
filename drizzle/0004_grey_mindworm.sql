CREATE TABLE "file_folders" (
	"id" text PRIMARY KEY NOT NULL,
	"department_id" text NOT NULL,
	"parent_folder_id" text,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"owner_label" text,
	"access_policy" text DEFAULT 'department_only' NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "file_permissions" (
	"id" text PRIMARY KEY NOT NULL,
	"department_id" text NOT NULL,
	"folder_id" text,
	"file_id" text,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"can_view" boolean DEFAULT true NOT NULL,
	"can_download" boolean DEFAULT true NOT NULL,
	"can_upload" boolean DEFAULT false NOT NULL,
	"can_manage" boolean DEFAULT false NOT NULL,
	"note" text,
	"granted_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "file_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"file_id" text NOT NULL,
	"version_number" integer NOT NULL,
	"original_filename" text NOT NULL,
	"storage_key" text NOT NULL,
	"mime_type" text NOT NULL,
	"file_extension" text NOT NULL,
	"byte_size" bigint NOT NULL,
	"sha256" text NOT NULL,
	"replaced_by_user_id" text,
	"change_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stored_files" (
	"id" text PRIMARY KEY NOT NULL,
	"department_id" text NOT NULL,
	"folder_id" text,
	"uploaded_by_user_id" text,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"original_filename" text NOT NULL,
	"storage_key" text NOT NULL,
	"mime_type" text NOT NULL,
	"file_extension" text NOT NULL,
	"byte_size" bigint NOT NULL,
	"sha256" text NOT NULL,
	"scan_status" text DEFAULT 'skipped' NOT NULL,
	"version_number" integer DEFAULT 1 NOT NULL,
	"access_policy" text DEFAULT 'inherit' NOT NULL,
	"download_count" integer DEFAULT 0 NOT NULL,
	"last_downloaded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "file_folders" ADD CONSTRAINT "file_folders_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_folders" ADD CONSTRAINT "file_folders_parent_folder_id_file_folders_id_fk" FOREIGN KEY ("parent_folder_id") REFERENCES "public"."file_folders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_folders" ADD CONSTRAINT "file_folders_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_permissions" ADD CONSTRAINT "file_permissions_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_permissions" ADD CONSTRAINT "file_permissions_folder_id_file_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."file_folders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_permissions" ADD CONSTRAINT "file_permissions_file_id_stored_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."stored_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_permissions" ADD CONSTRAINT "file_permissions_granted_by_user_id_users_id_fk" FOREIGN KEY ("granted_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_versions" ADD CONSTRAINT "file_versions_file_id_stored_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."stored_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_versions" ADD CONSTRAINT "file_versions_replaced_by_user_id_users_id_fk" FOREIGN KEY ("replaced_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stored_files" ADD CONSTRAINT "stored_files_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stored_files" ADD CONSTRAINT "stored_files_folder_id_file_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."file_folders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stored_files" ADD CONSTRAINT "stored_files_uploaded_by_user_id_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "file_folders_dept_parent_idx" ON "file_folders" USING btree ("department_id","parent_folder_id");--> statement-breakpoint
CREATE INDEX "file_folders_dept_policy_idx" ON "file_folders" USING btree ("department_id","access_policy");--> statement-breakpoint
CREATE INDEX "file_permissions_dept_target_idx" ON "file_permissions" USING btree ("department_id","target_type","target_id");--> statement-breakpoint
CREATE INDEX "file_permissions_folder_idx" ON "file_permissions" USING btree ("folder_id");--> statement-breakpoint
CREATE INDEX "file_permissions_file_idx" ON "file_permissions" USING btree ("file_id");--> statement-breakpoint
CREATE UNIQUE INDEX "file_versions_storage_key_unique_idx" ON "file_versions" USING btree ("storage_key");--> statement-breakpoint
CREATE INDEX "file_versions_file_ver_idx" ON "file_versions" USING btree ("file_id","version_number");--> statement-breakpoint
CREATE UNIQUE INDEX "stored_files_storage_key_unique_idx" ON "stored_files" USING btree ("storage_key");--> statement-breakpoint
CREATE INDEX "stored_files_dept_folder_idx" ON "stored_files" USING btree ("department_id","folder_id","created_at");--> statement-breakpoint
CREATE INDEX "stored_files_uploader_idx" ON "stored_files" USING btree ("uploaded_by_user_id");--> statement-breakpoint
CREATE INDEX "stored_files_policy_idx" ON "stored_files" USING btree ("access_policy");--> statement-breakpoint
CREATE UNIQUE INDEX "storage_quotas_scope_unique_idx" ON "storage_quotas" USING btree ("scope_type","scope_id");