CREATE TABLE "department_memberships" (
	"id" text PRIMARY KEY NOT NULL,
	"department_id" text NOT NULL,
	"user_id" text NOT NULL,
	"is_manager" boolean DEFAULT false NOT NULL,
	"is_available" boolean DEFAULT true NOT NULL,
	"max_active_tickets" integer DEFAULT 15 NOT NULL,
	"assigned_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "departments" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name_fa" text NOT NULL,
	"description_fa" text DEFAULT '' NOT NULL,
	"icon_key" text DEFAULT 'building' NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_public" boolean DEFAULT true NOT NULL,
	"ai_enabled" boolean DEFAULT true NOT NULL,
	"human_operators_available" boolean DEFAULT true NOT NULL,
	"assignment_strategy" text DEFAULT 'round_robin' NOT NULL,
	"welcome_message_fa" text DEFAULT '' NOT NULL,
	"max_upload_size_mb" integer DEFAULT 10 NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operator_availability" (
	"user_id" text PRIMARY KEY NOT NULL,
	"is_available" boolean DEFAULT true NOT NULL,
	"availability_note" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "department_memberships" ADD CONSTRAINT "department_memberships_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "department_memberships" ADD CONSTRAINT "department_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "department_memberships" ADD CONSTRAINT "department_memberships_assigned_by_users_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_availability" ADD CONSTRAINT "operator_availability_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "dept_memberships_dept_user_unique_idx" ON "department_memberships" USING btree ("department_id","user_id");--> statement-breakpoint
CREATE INDEX "dept_memberships_user_id_idx" ON "department_memberships" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "dept_memberships_dept_id_idx" ON "department_memberships" USING btree ("department_id");--> statement-breakpoint
CREATE UNIQUE INDEX "departments_slug_unique_idx" ON "departments" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "departments_public_order_idx" ON "departments" USING btree ("is_active","is_public","display_order");