CREATE TABLE "access_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"email" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone,
	"reviewed_by" text,
	"token_hash" text,
	"token_expires_at" timestamp with time zone,
	"last_notification_at" timestamp with time zone,
	"last_notification_attempt_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"ticker" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "access_requests_user_id_unique" ON "access_requests" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "access_requests_email_idx" ON "access_requests" USING btree ("email");--> statement-breakpoint
CREATE INDEX "access_requests_status_idx" ON "access_requests" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "usage_events_user_event_unique" ON "usage_events" USING btree ("user_id","event_id");--> statement-breakpoint
CREATE INDEX "usage_events_user_occurred_idx" ON "usage_events" USING btree ("user_id","occurred_at");--> statement-breakpoint
CREATE INDEX "usage_events_type_occurred_idx" ON "usage_events" USING btree ("event_type","occurred_at");