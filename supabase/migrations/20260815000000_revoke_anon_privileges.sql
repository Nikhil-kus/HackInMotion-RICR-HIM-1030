-- Security Hardening: Revoke broad anon privileges
-- Migration: 20260815000000_revoke_anon_privileges.sql
--
-- ISSUE (HIGH): The initial migration (20260812000000_initial_schema.sql) and
-- the purchase management migration (20260813000000_create_purchase_management.sql)
-- both issued GRANT ALL ... TO anon, giving unauthenticated database connections
-- full DML access to all application tables. Row Level Security is the only gate
-- for the anon role, so any RLS misconfiguration — or a future table added
-- without RLS — would immediately expose data to anonymous clients.
--
-- FIX:
--   1. Revoke ALL on application tables from anon.
--   2. Revoke ALL on sequences from anon (anon has no need to read or advance
--      any sequence; gen_random_uuid() is used for PKs, not serial sequences).
--   3. Revoke ALL on functions from anon — the only callable function is
--      create_retail_sale, which already gates on auth.uid() internally, but
--      it should only be callable by authenticated users.
--   4. Re-grant the minimum required privileges to authenticated and service_role
--      so all existing server-side/Supabase operations continue to work.
--
-- WHAT IS NOT CHANGED:
--   - RLS remains enabled and unchanged on every table.
--   - No schema changes — no tables, columns, or constraints are modified.
--   - authenticated and service_role retain full DML access.
--   - The create_retail_sale RPC retains EXECUTE for authenticated + service_role.
--   - product_aliases was already excluded from the original anon grant, so it
--     is unaffected (its targeted grant is left as-is).
--
-- SAFETY:
--   - All statements are REVOKE/GRANT on existing objects — no DDL, no data changes.
--   - Safe to run multiple times (REVOKE is idempotent for roles that have no grant).

-- ============================================================
-- 1. REVOKE from anon — tables created in the initial schema
-- ============================================================

REVOKE ALL ON public.products             FROM anon;
REVOKE ALL ON public.sales                FROM anon;
REVOKE ALL ON public.forecasts            FROM anon;
REVOKE ALL ON public.alerts               FROM anon;

-- ============================================================
-- 2. REVOKE from anon — tables created in the purchase management migration
-- ============================================================

REVOKE ALL ON public.suppliers            FROM anon;
REVOKE ALL ON public.product_suppliers    FROM anon;
REVOKE ALL ON public.purchase_orders      FROM anon;
REVOKE ALL ON public.purchase_order_items FROM anon;

-- ============================================================
-- 3. REVOKE ALL SEQUENCES from anon
-- ============================================================

REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;

-- ============================================================
-- 4. REVOKE ALL FUNCTIONS from anon (covers create_retail_sale)
-- ============================================================

REVOKE ALL ON ALL ROUTINES IN SCHEMA public FROM anon;

-- ============================================================
-- 5. Re-confirm minimum required grants for authenticated + service_role
--    (These were already granted; re-stating them makes this migration
--    self-documenting and safe to run on a fresh schema apply.)
-- ============================================================

GRANT ALL ON public.products             TO authenticated, service_role;
GRANT ALL ON public.sales                TO authenticated, service_role;
GRANT ALL ON public.forecasts            TO authenticated, service_role;
GRANT ALL ON public.alerts               TO authenticated, service_role;
GRANT ALL ON public.suppliers            TO authenticated, service_role;
GRANT ALL ON public.product_suppliers    TO authenticated, service_role;
GRANT ALL ON public.purchase_orders      TO authenticated, service_role;
GRANT ALL ON public.purchase_order_items TO authenticated, service_role;

GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.create_retail_sale(JSONB) TO authenticated, service_role;
