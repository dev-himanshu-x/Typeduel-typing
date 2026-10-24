CREATE TYPE "public"."match_reason" AS ENUM('finished', 'forfeit');--> statement-breakpoint
CREATE TABLE "match_results" (
	"match_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"final_wpm" numeric(6, 2) NOT NULL,
	"accuracy" numeric(5, 2) NOT NULL,
	"error_count" integer NOT NULL,
	"timeline_data" jsonb NOT NULL,
	CONSTRAINT "match_results_match_id_user_id_pk" PRIMARY KEY("match_id","user_id"),
	CONSTRAINT "match_results_sane" CHECK ("match_results"."final_wpm" >= 0 and "match_results"."accuracy" between 0 and 100 and "match_results"."error_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "matches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_code" char(6) NOT NULL,
	"player1_id" uuid NOT NULL,
	"player2_id" uuid NOT NULL,
	"winner_id" uuid,
	"word_count" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"seed" bigint NOT NULL,
	"bank_version" smallint NOT NULL,
	"reason" "match_reason" NOT NULL,
	"duration_ms" integer,
	CONSTRAINT "matches_distinct_players" CHECK ("matches"."player1_id" <> "matches"."player2_id"),
	CONSTRAINT "matches_winner_is_player" CHECK ("matches"."winner_id" is null or "matches"."winner_id" in ("matches"."player1_id", "matches"."player2_id")),
	CONSTRAINT "matches_word_count_pos" CHECK ("matches"."word_count" > 0)
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"username" varchar(16) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_username_format" CHECK ("users"."username" ~ '^[A-Za-z0-9_-]{1,16}$')
);
--> statement-breakpoint
ALTER TABLE "match_results" ADD CONSTRAINT "match_results_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_results" ADD CONSTRAINT "match_results_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_player1_id_users_id_fk" FOREIGN KEY ("player1_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_player2_id_users_id_fk" FOREIGN KEY ("player2_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_winner_id_users_id_fk" FOREIGN KEY ("winner_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "match_results_user_idx" ON "match_results" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "matches_p1_created_idx" ON "matches" USING btree ("player1_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "matches_p2_created_idx" ON "matches" USING btree ("player2_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "matches_room_code_idx" ON "matches" USING btree ("room_code");--> statement-breakpoint
CREATE UNIQUE INDEX "users_username_lower_uq" ON "users" USING btree (lower("username"));