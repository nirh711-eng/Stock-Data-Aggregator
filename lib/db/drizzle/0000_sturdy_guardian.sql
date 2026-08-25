CREATE TABLE "user_preferences" (
	"user_id" text PRIMARY KEY NOT NULL,
	"watchlist" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tracked_articles" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sector_symbol_availability" (
	"scan_scope" text NOT NULL,
	"symbol" text NOT NULL,
	"reason" text NOT NULL,
	"consecutive_failures" integer DEFAULT 1 NOT NULL,
	"first_failed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_failed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sector_symbol_availability_pkey" PRIMARY KEY("scan_scope","symbol","reason")
);
