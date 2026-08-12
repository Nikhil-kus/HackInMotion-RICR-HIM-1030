-- Add shelf_life_days to products table
ALTER TABLE public.products 
ADD COLUMN IF NOT EXISTS shelf_life_days INTEGER CHECK (shelf_life_days > 0);
