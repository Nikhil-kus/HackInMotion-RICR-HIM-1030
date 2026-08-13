-- Phase 10A: Kirana Product & Catalog Foundation
-- Migration: 20260814000000_kirana_product_catalog.sql
--
-- Adds 5 optional Kirana-oriented columns to products and creates the
-- product_aliases table for local/Hindi name search.
--
-- SAFETY:
--   - All ALTER TABLE use IF NOT EXISTS — safe to run multiple times.
--   - No existing columns are renamed, dropped, or modified.
--   - No existing data is altered.
--   - product_aliases cascades delete from products via FK.

-- ============================================================
-- 1. ADD NEW OPTIONAL COLUMNS TO products
-- ============================================================

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS barcode       TEXT,
  ADD COLUMN IF NOT EXISTS brand         TEXT,
  ADD COLUMN IF NOT EXISTS unit          TEXT,
  ADD COLUMN IF NOT EXISTS pack_size     NUMERIC(10, 3),
  ADD COLUMN IF NOT EXISTS pack_size_unit TEXT;

-- Barcode index: scoped per user (different users can share the same barcode)
-- Partial index only covers rows where barcode is set, keeping it lean.
CREATE INDEX IF NOT EXISTS idx_products_user_barcode
  ON public.products(user_id, barcode)
  WHERE barcode IS NOT NULL;

-- Brand index: used for brand-name search in inventory
CREATE INDEX IF NOT EXISTS idx_products_user_brand
  ON public.products(user_id, brand)
  WHERE brand IS NOT NULL;

-- ============================================================
-- 2. product_aliases TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS public.product_aliases (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL REFERENCES auth.users(id)    ON DELETE CASCADE,
  product_id UUID        NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  alias      TEXT        NOT NULL,
  language   TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- ============================================================
-- 3. ROW LEVEL SECURITY FOR product_aliases
-- ============================================================

ALTER TABLE public.product_aliases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own aliases"
  ON public.product_aliases
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own aliases"
  ON public.product_aliases
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own aliases"
  ON public.product_aliases
  FOR UPDATE
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own aliases"
  ON public.product_aliases
  FOR DELETE
  USING (auth.uid() = user_id);

-- ============================================================
-- 4. INDEXES FOR product_aliases
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_product_aliases_user_id
  ON public.product_aliases(user_id);

CREATE INDEX IF NOT EXISTS idx_product_aliases_product_id
  ON public.product_aliases(product_id);

-- Supports fast alias text lookups scoped to the user
CREATE INDEX IF NOT EXISTS idx_product_aliases_user_alias
  ON public.product_aliases(user_id, alias);

-- ============================================================
-- 5. GRANT PERMISSIONS
--
-- SR-2: product_aliases is an authenticated-only feature.
-- Do NOT grant to anon — the broad GRANT on the initial schema
-- pre-dates this table. We issue a targeted grant here that
-- intentionally excludes anon. RLS is the primary row-level
-- isolation mechanism.
-- ============================================================

GRANT ALL ON public.product_aliases TO authenticated, service_role;
