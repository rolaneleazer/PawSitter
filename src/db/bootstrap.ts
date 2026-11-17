import type { PoolAdapter } from "./index.ts";

/**
 * Idempotent schema bootstrap for remote PostgreSQL databases (e.g., a brand-new Supabase Free Tier DB).
 * Ensures all enum types and base tables exist before server.ts runs incremental migrations and seeding.
 */
export async function bootstrapRemotePostgresSchema(pool: PoolAdapter | any): Promise<void> {
  // 1. Create custom enum types safely (idempotent)
  await pool.query(`
    DO $$ BEGIN
      CREATE TYPE "public"."booking_status" AS ENUM('PENDING', 'CONFIRMED', 'IN_PROGRESS', 'CANCELLED', 'COMPLETED');
    EXCEPTION WHEN duplicate_object THEN null;
    END $$;

    DO $$ BEGIN
      ALTER TYPE "public"."booking_status" ADD VALUE IF NOT EXISTS 'IN_PROGRESS' BEFORE 'CANCELLED';
    EXCEPTION WHEN others THEN null;
    END $$;

    DO $$ BEGIN
      CREATE TYPE "public"."meet_and_greet_status" AS ENUM('REQUESTED', 'SCHEDULED', 'COMPLETED', 'CANCELLED');
    EXCEPTION WHEN duplicate_object THEN null;
    END $$;

    DO $$ BEGIN
      CREATE TYPE "public"."payment_status" AS ENUM('PENDING', 'AUTHORIZED', 'HELD_IN_ESCROW', 'RELEASED', 'REFUNDED', 'DISPUTED');
    EXCEPTION WHEN duplicate_object THEN null;
    END $$;

    DO $$ BEGIN
      CREATE TYPE "public"."user_role" AS ENUM('PET_OWNER', 'PET_SITTER', 'ADMIN', 'SUPPORT_AGENT');
    EXCEPTION WHEN duplicate_object THEN null;
    END $$;

    DO $$ BEGIN
      CREATE TYPE "public"."service_modality" AS ENUM('BOARDING', 'HOUSE_SITTING', 'DROP_IN', 'DAY_CARE', 'DOG_WALKING');
    EXCEPTION WHEN duplicate_object THEN null;
    END $$;
  `);

  // 2. Create base tables in dependency order
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "custom_roles" (
      "id" serial PRIMARY KEY NOT NULL,
      "name" text NOT NULL UNIQUE,
      "permissions" jsonb DEFAULT '{}'::jsonb NOT NULL,
      "created_at" timestamp DEFAULT now() NOT NULL
    );

    CREATE TABLE IF NOT EXISTS "users" (
      "id" serial PRIMARY KEY NOT NULL,
      "uid" text NOT NULL UNIQUE,
      "name" text,
      "first_name" text,
      "middle_name" text,
      "last_name" text,
      "email" text NOT NULL UNIQUE,
      "role" "user_role" DEFAULT 'PET_OWNER' NOT NULL,
      "custom_role_id" integer REFERENCES "custom_roles"("id"),
      "is_verified" boolean DEFAULT false NOT NULL,
      "stripe_account_id" text,
      "stripe_customer_id" text,
      "password_hash" text,
      "is_suspended" boolean DEFAULT false NOT NULL,
      "suspension_reason" text,
      "suspended_at" timestamp,
      "phone" text,
      "country_code" text DEFAULT '+63',
      "profile_picture" text,
      "created_at" timestamp DEFAULT now() NOT NULL
    );

    CREATE TABLE IF NOT EXISTS "sitter_profiles" (
      "id" serial PRIMARY KEY NOT NULL,
      "user_id" integer NOT NULL UNIQUE REFERENCES "users"("id") ON DELETE CASCADE,
      "bio" text,
      "experience_details" text,
      "latitude" numeric,
      "longitude" numeric,
      "service_radius_miles" integer DEFAULT 5 NOT NULL,
      "rating" numeric(3, 2),
      "photos" jsonb DEFAULT '[]'::jsonb,
      "proof_album" jsonb DEFAULT '[]'::jsonb,
      "environment_info" jsonb DEFAULT '{}'::jsonb,
      "pet_preferences" jsonb DEFAULT '{}'::jsonb,
      "daily_routine" jsonb DEFAULT '{}'::jsonb,
      "skills_list" jsonb DEFAULT '[]'::jsonb,
      "sitter_tier" text DEFAULT 'NOVICE',
      "rates_locked" boolean DEFAULT false,
      "rate_approval_status" text DEFAULT 'APPROVED',
      "rate_rejection_reason" text,
      "max_pets_per_booking" integer DEFAULT 2,
      "created_at" timestamp DEFAULT now() NOT NULL
    );

    CREATE TABLE IF NOT EXISTS "sitter_availabilities" (
      "id" serial PRIMARY KEY NOT NULL,
      "sitter_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
      "day_of_week" integer NOT NULL,
      "start_time" time NOT NULL,
      "end_time" time NOT NULL
    );

    CREATE TABLE IF NOT EXISTS "sitter_blockouts" (
      "id" serial PRIMARY KEY NOT NULL,
      "sitter_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
      "start_date" date NOT NULL,
      "end_date" date NOT NULL
    );

    CREATE TABLE IF NOT EXISTS "sitter_rate_cards" (
      "id" serial PRIMARY KEY NOT NULL,
      "sitter_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
      "modality" "service_modality" NOT NULL,
      "base_rate" integer NOT NULL CHECK ("base_rate" > 0),
      "duration_unit_minutes" integer DEFAULT 60 NOT NULL,
      "extra_pet_fee" integer DEFAULT 0,
      "puppy_rate" integer DEFAULT 0,
      "medication_surcharge" integer DEFAULT 0,
      "holiday_multiplier" numeric(3, 2) DEFAULT '1.0',
      "rush_hour_surcharge" integer DEFAULT 0,
      "max_pets_per_booking" integer DEFAULT 2,
      "is_admin_override" boolean DEFAULT false,
      "status" text DEFAULT 'ACTIVE'
    );

    CREATE TABLE IF NOT EXISTS "platform_fee_configs" (
      "id" serial PRIMARY KEY NOT NULL,
      "owner_fee_percentage" numeric(7, 4) NOT NULL,
      "owner_fee_cap" integer,
      "sitter_commission_percentage" numeric(7, 4) NOT NULL,
      "fixed_transaction_fee" integer NOT NULL,
      "effective_from" timestamp DEFAULT now() NOT NULL
    );

    CREATE TABLE IF NOT EXISTS "pets" (
      "id" serial PRIMARY KEY NOT NULL,
      "owner_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
      "name" text NOT NULL,
      "type" text NOT NULL,
      "breed" text,
      "age" integer,
      "weight" numeric(5, 2),
      "photo_url" text,
      "food_type" text,
      "food_grams_per_meal" numeric(6, 2),
      "food_frequency" text,
      "other_notes" text,
      "vaccination_records_url" text,
      "dietary_restrictions" text,
      "medical_conditions" text,
      "medication_requirements" text,
      "behavioral_notes" text,
      "created_at" timestamp DEFAULT now() NOT NULL
    );

    CREATE TABLE IF NOT EXISTS "vet_authorizations" (
      "id" serial PRIMARY KEY NOT NULL,
      "pet_id" integer NOT NULL REFERENCES "pets"("id") ON DELETE CASCADE,
      "clinic_name" text NOT NULL,
      "clinic_phone" text NOT NULL,
      "clinic_address" text NOT NULL,
      "digital_signature" text NOT NULL,
      "pre_authorized_spend_limit" integer NOT NULL,
      "created_at" timestamp DEFAULT now() NOT NULL
    );

    CREATE TABLE IF NOT EXISTS "meet_and_greets" (
      "id" serial PRIMARY KEY NOT NULL,
      "owner_id" integer NOT NULL REFERENCES "users"("id"),
      "sitter_id" integer NOT NULL REFERENCES "users"("id"),
      "status" "meet_and_greet_status" DEFAULT 'REQUESTED' NOT NULL,
      "scheduled_time" timestamp,
      "location" text,
      "owner_confirmed" boolean DEFAULT false,
      "sitter_confirmed" boolean DEFAULT false
    );

    CREATE TABLE IF NOT EXISTS "bookings" (
      "id" serial PRIMARY KEY NOT NULL,
      "owner_id" integer NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
      "sitter_id" integer NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
      "status" "booking_status" DEFAULT 'PENDING' NOT NULL,
      "start_time" timestamp NOT NULL,
      "end_time" timestamp NOT NULL,
      "total_amount" integer NOT NULL,
      "house_location_address" text,
      "house_location_details" jsonb DEFAULT '{}'::jsonb,
      "intake_questionnaire" jsonb DEFAULT '{}'::jsonb,
      "routine_approval_status" text DEFAULT 'PENDING_APPROVAL',
      "routine_proposal_notes" text,
      "routine_approved_at" timestamp,
      "routine_approved_by" integer,
      "created_at" timestamp DEFAULT now() NOT NULL,
      CONSTRAINT "time_check" CHECK ("end_time" > "start_time")
    );

    CREATE TABLE IF NOT EXISTS "booking_financial_snapshots" (
      "id" serial PRIMARY KEY NOT NULL,
      "booking_id" integer NOT NULL UNIQUE REFERENCES "bookings"("id") ON DELETE CASCADE,
      "base_rate_applied" integer NOT NULL,
      "duration_unit_minutes_applied" integer NOT NULL,
      "extra_pet_fee_applied" integer DEFAULT 0,
      "puppy_rate_applied" integer DEFAULT 0,
      "medication_surcharge_applied" integer DEFAULT 0,
      "holiday_multiplier_applied" numeric(3, 2) DEFAULT '1.0',
      "rush_hour_surcharge_applied" integer DEFAULT 0,
      "platform_owner_fee_percentage_applied" numeric(7, 4) NOT NULL,
      "platform_sitter_commission_percentage_applied" numeric(7, 4) NOT NULL,
      "owner_fee_cap_applied" integer,
      "fixed_transaction_fee_applied" integer NOT NULL,
      "calculated_base_total" integer NOT NULL,
      "calculated_owner_fee" integer NOT NULL,
      "calculated_sitter_commission" integer NOT NULL,
      "calculated_sitter_payout" integer NOT NULL,
      "calculated_total_owner_charge" integer NOT NULL,
      "calculated_net_platform_revenue" integer NOT NULL,
      "tip_amount" integer DEFAULT 0 NOT NULL
    );

    CREATE TABLE IF NOT EXISTS "payments" (
      "id" serial PRIMARY KEY NOT NULL,
      "booking_id" integer NOT NULL REFERENCES "bookings"("id"),
      "stripe_payment_intent_id" text,
      "transfer_group" text NOT NULL UNIQUE,
      "status" "payment_status" DEFAULT 'PENDING' NOT NULL,
      "escrow_release_timestamp" timestamp,
      "dispute_flag" boolean DEFAULT false
    );

    CREATE TABLE IF NOT EXISTS "visit_checkin_cards" (
      "id" serial PRIMARY KEY NOT NULL,
      "booking_id" integer NOT NULL REFERENCES "bookings"("id"),
      "check_in_time" timestamp DEFAULT now() NOT NULL,
      "latitude" numeric,
      "longitude" numeric,
      "potty_log" text,
      "food_water_tracking" text,
      "photo_urls" jsonb DEFAULT '[]'::jsonb,
      "notes" text
    );

    CREATE TABLE IF NOT EXISTS "audit_logs" (
      "id" serial PRIMARY KEY NOT NULL,
      "actor_uid" text,
      "table_name" text NOT NULL,
      "record_id" integer NOT NULL,
      "action" text NOT NULL,
      "old_data" jsonb,
      "new_data" jsonb,
      "ip_address" text,
      "created_at" timestamp DEFAULT now() NOT NULL
    );
  `);
}
