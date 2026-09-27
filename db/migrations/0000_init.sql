CREATE TABLE "api_idempotency" (
	"user_id" bigint NOT NULL,
	"route" text NOT NULL,
	"key" text NOT NULL,
	"status_code" integer NOT NULL,
	"body" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_idempotency_pk" PRIMARY KEY("user_id","route","key")
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "audit_log_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_bind_token" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"chat_id" bigint NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_card" (
	"incident_id" bigint PRIMARY KEY NOT NULL,
	"chat_id" bigint NOT NULL,
	"mid" text,
	"render_hash" text,
	"last_edited_at" timestamp with time zone,
	"check_mid" text,
	"check_render_hash" text,
	"result_mid" text
);
--> statement-breakpoint
CREATE TABLE "deadline" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "deadline_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"incident_id" bigint NOT NULL,
	"norm_id" bigint NOT NULL,
	"kind" text NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"warn_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"warned_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "deadline_incident_norm" UNIQUE("incident_id","norm_id"),
	CONSTRAINT "deadline_kind" CHECK ("deadline"."kind" in ('answer', 'localize', 'clog', 'fix', 'single_limit')),
	CONSTRAINT "deadline_status" CHECK ("deadline"."status" in ('pending', 'met', 'breached', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "fake_max_call" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "fake_max_call_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"method" text NOT NULL,
	"path" text NOT NULL,
	"query" jsonb,
	"body" jsonb,
	"response_status" integer NOT NULL,
	"response" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "house" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "house_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"public_id" text NOT NULL,
	"uk_id" bigint NOT NULL,
	"label" text NOT NULL,
	"address" text NOT NULL,
	"city" text NOT NULL,
	"timezone" text NOT NULL,
	"region_code" text,
	"entrances" integer NOT NULL,
	"floors" integer NOT NULL,
	"flats_per_floor" integer NOT NULL,
	"flat_from" integer NOT NULL,
	"flat_to" integer NOT NULL,
	"power_sources" smallint DEFAULT 2 NOT NULL,
	"hot_water_dead_end" boolean DEFAULT false NOT NULL,
	"is_model" boolean DEFAULT false NOT NULL,
	"is_sandbox" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "house_public_id_unique" UNIQUE("public_id"),
	CONSTRAINT "house_flat_range" CHECK ("house"."flat_from" <= "house"."flat_to"),
	CONSTRAINT "house_entrances_positive" CHECK ("house"."entrances" >= 1 and "house"."floors" >= 1 and "house"."flats_per_floor" >= 1),
	CONSTRAINT "house_power_sources" CHECK ("house"."power_sources" in (1, 2))
);
--> statement-breakpoint
CREATE TABLE "house_chat" (
	"house_id" bigint PRIMARY KEY NOT NULL,
	"chat_id" bigint NOT NULL,
	"title" text,
	"invite_link" text,
	"bot_is_admin" boolean DEFAULT false NOT NULL,
	"bot_permissions" text[],
	"panel_mid" text,
	"panel_render_hash" text,
	"panel_pinned" boolean DEFAULT false NOT NULL,
	"panel_edited_at" timestamp with time zone,
	"participants_count" integer,
	"bound_at" timestamp with time zone DEFAULT now() NOT NULL,
	"bound_by" bigint,
	CONSTRAINT "house_chat_chat_id_unique" UNIQUE("chat_id")
);
--> statement-breakpoint
CREATE TABLE "inbound_update" (
	"dedupe_key" text PRIMARY KEY NOT NULL,
	"update_type" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "incident" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "incident_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"public_id" text NOT NULL,
	"house_id" bigint NOT NULL,
	"kind" text DEFAULT 'outage' NOT NULL,
	"service_type" text NOT NULL,
	"scope" text NOT NULL,
	"entrance" integer,
	"status" text DEFAULT 'open' NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"started_source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ads_reg_number" text,
	"ads_reg_at" timestamp with time zone,
	"eta_at" timestamp with time zone,
	"overdue" boolean DEFAULT false NOT NULL,
	"single_limit_exceeded" boolean DEFAULT false NOT NULL,
	"discrepancy_unresolved" boolean DEFAULT false NOT NULL,
	"created_by" bigint,
	"merged_into_id" bigint,
	"brigade_on_site_at" timestamp with time zone,
	"localized_at" timestamp with time zone,
	"resolved_at_uk" timestamp with time zone,
	"check_started_at" timestamp with time zone,
	"discrepancy_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"is_model" boolean DEFAULT false NOT NULL,
	"is_sandbox" boolean DEFAULT false NOT NULL,
	CONSTRAINT "incident_public_id_unique" UNIQUE("public_id"),
	CONSTRAINT "incident_kind" CHECK ("incident"."kind" in ('outage')),
	CONSTRAINT "incident_service_type" CHECK ("incident"."service_type" in ('cold_water', 'hot_water', 'heating', 'electricity', 'sewerage', 'gas', 'leak')),
	CONSTRAINT "incident_scope" CHECK ("incident"."scope" in ('flat', 'entrance', 'house')),
	CONSTRAINT "incident_status" CHECK ("incident"."status" in ('open', 'accepted', 'brigade_on_site', 'localized', 'checking', 'discrepancy', 'closed', 'merged')),
	CONSTRAINT "incident_entrance_scope" CHECK ("incident"."scope" <> 'entrance' or "incident"."entrance" is not null)
);
--> statement-breakpoint
CREATE TABLE "incident_event" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "incident_event_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"incident_id" bigint NOT NULL,
	"type" text NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" bigint,
	"source" text NOT NULL,
	"payload" jsonb,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "incident_event_type" CHECK ("incident_event"."type" in ('reported', 'joined', 'left', 'ads_registered', 'ads_not_reached', 'uk_accepted', 'uk_brigade_on_site', 'residents_brigade_confirmed', 'residents_no_brigade', 'uk_localized', 'uk_resolved', 'skipped_steps', 'check_asked', 'check_repeated', 'restored_yes', 'restored_no', 'restored_weak', 'ads_rereported', 'discrepancy', 'act_ready', 'deadline_warned', 'deadline_met', 'deadline_breached', 'closed', 'merged', 'demo_time_shift', 'demo_neighbours_added')),
	CONSTRAINT "incident_event_actor" CHECK ("incident_event"."actor_type" in ('resident', 'uk', 'system')),
	CONSTRAINT "incident_event_source" CHECK ("incident_event"."source" in ('bot', 'miniapp', 'api', 'system'))
);
--> statement-breakpoint
CREATE TABLE "incident_participant" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "incident_participant_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"incident_id" bigint NOT NULL,
	"user_id" bigint,
	"residency_id" bigint,
	"affected" boolean DEFAULT true NOT NULL,
	"entrance" integer,
	"floor" integer,
	"trust_level_at_join" smallint DEFAULT 0 NOT NULL,
	"notify" boolean DEFAULT true NOT NULL,
	"restored_answer" text,
	"restored_answer_at" timestamp with time zone,
	"restored_at" timestamp with time zone,
	"restored_source" text,
	"ads_rereport_number" text,
	"ads_rereport_at" timestamp with time zone,
	"brigade_seen" boolean,
	"brigade_seen_at" timestamp with time zone,
	"ready_to_sign" boolean DEFAULT false NOT NULL,
	"share_contact_consent" boolean DEFAULT false NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_model" boolean DEFAULT false NOT NULL,
	CONSTRAINT "incident_participant_incident_user" UNIQUE("incident_id","user_id"),
	CONSTRAINT "incident_participant_trust" CHECK ("incident_participant"."trust_level_at_join" in (0, 1, 2)),
	CONSTRAINT "incident_participant_answer" CHECK ("incident_participant"."restored_answer" is null or "incident_participant"."restored_answer" in ('yes', 'no', 'weak')),
	CONSTRAINT "incident_participant_source" CHECK ("incident_participant"."restored_source" is null or "incident_participant"."restored_source" in ('uk_mark', 'resident_answer', 'ads_report'))
);
--> statement-breakpoint
CREATE TABLE "management_company" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "management_company_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"public_id" text NOT NULL,
	"name" text NOT NULL,
	"ads_phone" text NOT NULL,
	"region_code" text,
	"is_model" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "management_company_public_id_unique" UNIQUE("public_id")
);
--> statement-breakpoint
CREATE TABLE "max_user" (
	"id" bigint PRIMARY KEY NOT NULL,
	"locale" text,
	"consent_version" text,
	"consent_at" timestamp with time zone,
	"dialog_active" boolean DEFAULT false NOT NULL,
	"dialog_state" jsonb,
	"dialog_state_at" timestamp with time zone,
	"notify_default" boolean DEFAULT true NOT NULL,
	"is_model" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "norm" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "norm_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"code" text NOT NULL,
	"service_type" text,
	"event" text NOT NULL,
	"title" text NOT NULL,
	"value" numeric NOT NULL,
	"unit" text NOT NULL,
	"rate_percent" numeric,
	"calc_strategy" text,
	"round" text,
	"region_code" text,
	"condition" jsonb,
	"basis_doc" text NOT NULL,
	"basis_point" text NOT NULL,
	"basis_quote" text,
	"text_plain" text NOT NULL,
	"edition_date" date NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"checked_at" date,
	"source_url" text NOT NULL,
	"note" text,
	CONSTRAINT "norm_code_region_valid_from" UNIQUE NULLS NOT DISTINCT("code","region_code","valid_from"),
	CONSTRAINT "norm_service_type" CHECK ("norm"."service_type" is null or "norm"."service_type" in ('cold_water', 'hot_water', 'heating', 'electricity', 'sewerage', 'gas', 'leak')),
	CONSTRAINT "norm_event" CHECK ("norm"."event" in ('ads_answer', 'uk_eta', 'localize', 'clog_clear', 'fix', 'inform_causes', 'check_visit', 'act_without_executor', 'act_copy', 'interruption_single', 'interruption_monthly', 'quality_temperature')),
	CONSTRAINT "norm_unit" CHECK ("norm"."unit" in ('min', 'h', 'day', 'workday', 'person', 'celsius')),
	CONSTRAINT "norm_calc_strategy" CHECK ("norm"."calc_strategy" is null or "norm"."calc_strategy" in ('monthly_total', 'max_of_single_and_monthly')),
	CONSTRAINT "norm_round" CHECK ("norm"."round" is null or "norm"."round" in ('ceil', 'floor', 'exact'))
);
--> statement-breakpoint
CREATE TABLE "outbound_message" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "outbound_message_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"kind" text NOT NULL,
	"incident_id" bigint,
	"chat_id" bigint,
	"user_id" bigint,
	"payload" jsonb,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"mid" text,
	"idempotency_key" text NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	CONSTRAINT "outbound_message_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "outbound_message_kind" CHECK ("outbound_message"."kind" in ('card_create', 'card_replace', 'card_edit', 'check_question', 'check_edit', 'result', 'panel_create', 'panel_edit', 'panel_pin', 'bind_invite', 'callback_answer', 'dm', 'keyword_reply', 'poll', 'monthly_summary', 'alert')),
	CONSTRAINT "outbound_message_status" CHECK ("outbound_message"."status" in ('pending', 'sent', 'failed', 'skipped')),
	CONSTRAINT "outbound_message_target" CHECK ("outbound_message"."chat_id" is not null or "outbound_message"."user_id" is not null or "outbound_message"."kind" = 'callback_answer')
);
--> statement-breakpoint
CREATE TABLE "owner_invite" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"incident_id" bigint NOT NULL,
	"residency_id" bigint NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"result" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "owner_invite_result" CHECK ("owner_invite"."result" is null or "owner_invite"."result" in ('confirmed', 'rejected'))
);
--> statement-breakpoint
CREATE TABLE "poll" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "poll_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"type" text NOT NULL,
	"house_id" bigint NOT NULL,
	"incident_id" bigint,
	"mid" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"is_model" boolean DEFAULT false NOT NULL,
	CONSTRAINT "poll_type" CHECK ("poll"."type" in ('water_quality', 'heating'))
);
--> statement-breakpoint
CREATE TABLE "poll_answer" (
	"poll_id" bigint NOT NULL,
	"user_id" bigint NOT NULL,
	"value" text NOT NULL,
	"entrance" integer,
	"floor" integer,
	"answered_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "poll_answer_pk" PRIMARY KEY("poll_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "residency" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "residency_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"user_id" bigint NOT NULL,
	"house_id" bigint NOT NULL,
	"flat_no" integer NOT NULL,
	"role" text NOT NULL,
	"trust_level" smallint DEFAULT 0 NOT NULL,
	"review_status" text DEFAULT 'pending' NOT NULL,
	"source" text,
	"confirmed_by" text,
	"confirmed_at" timestamp with time zone,
	"membership_checked_at" timestamp with time zone,
	"is_model" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "residency_user_house" UNIQUE("user_id","house_id"),
	CONSTRAINT "residency_role" CHECK ("residency"."role" in ('owner', 'social_tenant', 'renter', 'family')),
	CONSTRAINT "residency_trust_level" CHECK ("residency"."trust_level" in (0, 1, 2)),
	CONSTRAINT "residency_review_status" CHECK ("residency"."review_status" in ('pending', 'confirmed', 'rejected')),
	CONSTRAINT "residency_source" CHECK ("residency"."source" is null or "residency"."source" in ('chat', 'qr', 'dm', 'miniapp', 'owner_link'))
);
--> statement-breakpoint
CREATE TABLE "staff" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "staff_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"user_id" bigint NOT NULL,
	"uk_id" bigint NOT NULL,
	"role" text NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"is_checker" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_user_uk" UNIQUE("user_id","uk_id"),
	CONSTRAINT "staff_role" CHECK ("staff"."role" in ('dispatcher', 'curator', 'admin'))
);
--> statement-breakpoint
ALTER TABLE "chat_card" ADD CONSTRAINT "chat_card_incident_id_incident_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."incident"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deadline" ADD CONSTRAINT "deadline_incident_id_incident_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."incident"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deadline" ADD CONSTRAINT "deadline_norm_id_norm_id_fk" FOREIGN KEY ("norm_id") REFERENCES "public"."norm"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "house" ADD CONSTRAINT "house_uk_id_management_company_id_fk" FOREIGN KEY ("uk_id") REFERENCES "public"."management_company"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "house_chat" ADD CONSTRAINT "house_chat_house_id_house_id_fk" FOREIGN KEY ("house_id") REFERENCES "public"."house"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident" ADD CONSTRAINT "incident_house_id_house_id_fk" FOREIGN KEY ("house_id") REFERENCES "public"."house"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident" ADD CONSTRAINT "incident_merged_into_id_incident_id_fk" FOREIGN KEY ("merged_into_id") REFERENCES "public"."incident"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_event" ADD CONSTRAINT "incident_event_incident_id_incident_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."incident"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_participant" ADD CONSTRAINT "incident_participant_incident_id_incident_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."incident"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_participant" ADD CONSTRAINT "incident_participant_residency_id_residency_id_fk" FOREIGN KEY ("residency_id") REFERENCES "public"."residency"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_message" ADD CONSTRAINT "outbound_message_incident_id_incident_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."incident"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_invite" ADD CONSTRAINT "owner_invite_incident_id_incident_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."incident"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_invite" ADD CONSTRAINT "owner_invite_residency_id_residency_id_fk" FOREIGN KEY ("residency_id") REFERENCES "public"."residency"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "poll" ADD CONSTRAINT "poll_house_id_house_id_fk" FOREIGN KEY ("house_id") REFERENCES "public"."house"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "poll" ADD CONSTRAINT "poll_incident_id_incident_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."incident"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "poll_answer" ADD CONSTRAINT "poll_answer_poll_id_poll_id_fk" FOREIGN KEY ("poll_id") REFERENCES "public"."poll"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "residency" ADD CONSTRAINT "residency_user_id_max_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."max_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "residency" ADD CONSTRAINT "residency_house_id_house_id_fk" FOREIGN KEY ("house_id") REFERENCES "public"."house"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff" ADD CONSTRAINT "staff_user_id_max_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."max_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff" ADD CONSTRAINT "staff_uk_id_management_company_id_fk" FOREIGN KEY ("uk_id") REFERENCES "public"."management_company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_at" ON "audit_log" USING btree ("at");--> statement-breakpoint
CREATE INDEX "deadline_pending_due" ON "deadline" USING btree ("status","due_at");--> statement-breakpoint
CREATE INDEX "fake_max_call_created" ON "fake_max_call" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "inbound_update_received" ON "inbound_update" USING btree ("received_at");--> statement-breakpoint
CREATE UNIQUE INDEX "incident_active_house_service" ON "incident" USING btree ("house_id","service_type") WHERE "incident"."status" in ('open', 'accepted', 'brigade_on_site', 'localized', 'checking', 'discrepancy') and "incident"."scope" <> 'flat';--> statement-breakpoint
CREATE INDEX "incident_house_status" ON "incident" USING btree ("house_id","status");--> statement-breakpoint
CREATE INDEX "incident_house_service_started" ON "incident" USING btree ("house_id","service_type","started_at");--> statement-breakpoint
CREATE INDEX "incident_event_incident_time" ON "incident_event" USING btree ("incident_id","occurred_at");--> statement-breakpoint
CREATE INDEX "incident_participant_user" ON "incident_participant" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "norm_service_event" ON "norm" USING btree ("service_type","event");--> statement-breakpoint
CREATE INDEX "outbound_message_incident_kind" ON "outbound_message" USING btree ("incident_id","kind");--> statement-breakpoint
CREATE INDEX "poll_house_started" ON "poll" USING btree ("house_id","started_at");--> statement-breakpoint
CREATE INDEX "residency_house_flat" ON "residency" USING btree ("house_id","flat_no");