CREATE TYPE "public"."event_type" AS ENUM('ProjectRegistered', 'SourceKeyAttached', 'ProjectsMerged', 'ProjectSplit');--> statement-breakpoint
CREATE TABLE "project_events" (
	"sequence" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "project_events_sequence_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"type" "event_type" NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"project_ids" text[] NOT NULL,
	"payload" jsonb NOT NULL
);
