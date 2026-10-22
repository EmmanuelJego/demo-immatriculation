ALTER TABLE "projects" ADD COLUMN "merged_into" text;--> statement-breakpoint
ALTER TABLE "source_keys" ADD COLUMN "origin_project_id" text;--> statement-breakpoint
-- Before any merge, every key is still on the project it was first attached to.
UPDATE "source_keys" SET "origin_project_id" = "project_id";--> statement-breakpoint
ALTER TABLE "source_keys" ALTER COLUMN "origin_project_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_merged_into_projects_id_fk" FOREIGN KEY ("merged_into") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_keys" ADD CONSTRAINT "source_keys_origin_project_id_projects_id_fk" FOREIGN KEY ("origin_project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_merged_into_check" CHECK (("projects"."status" = 'MERGED') = ("projects"."merged_into" is not null));