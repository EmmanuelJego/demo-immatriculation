CREATE TYPE "public"."project_status" AS ENUM('ACTIVE', 'MERGED', 'SPLIT');--> statement-breakpoint
CREATE TABLE "projects" (
	"id" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"owner_siren" char(9) NOT NULL,
	"status" "project_status" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_keys" (
	"system" text NOT NULL,
	"external_id" text NOT NULL,
	"project_id" text NOT NULL,
	"attached_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "source_keys_pkey" PRIMARY KEY("system","external_id")
);
--> statement-breakpoint
ALTER TABLE "source_keys" ADD CONSTRAINT "source_keys_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "source_keys_project_id_index" ON "source_keys" USING btree ("project_id");