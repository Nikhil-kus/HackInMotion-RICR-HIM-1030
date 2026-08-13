-- Phase 10B: True Atomic Sale & Stock Deduction RPC
-- Migration: 20260814000001_create_retail_sale_rpc.sql

CREATE OR REPLACE FUNCTION public.create_retail_sale(p_items JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id UUID;
  v_item JSONB;
  v_product_id UUID;
  v_quantity INT;
  v_product_name TEXT;
  v_db_price NUMERIC(10,2);
  v_current_stock INT;
  v_total_items INT := 0;
  v_total_units INT := 0;
  v_total_revenue NUMERIC(10,2) := 0.00;
BEGIN
  -- 1. Verify authenticated user session
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized. Please log in.';
  END IF;

  -- 2. Validate input array
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Cart is empty.';
  END IF;

  -- 3. Loop over items, lock product rows, validate stock & quantities, insert sales, update stock
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_product_id := (v_item->>'product_id')::UUID;
    v_quantity := (v_item->>'quantity')::INT;

    IF v_quantity IS NULL OR v_quantity <= 0 THEN
      RAISE EXCEPTION 'Invalid quantity for item %', v_product_id;
    END IF;

    -- Fetch product details with row lock (FOR UPDATE)
    SELECT name, price, current_stock
      INTO v_product_name, v_db_price, v_current_stock
      FROM public.products
     WHERE id = v_product_id AND user_id = v_user_id
     FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Product not found or access denied (ID: %).', v_product_id;
    END IF;

    -- Verify sufficient stock
    IF v_current_stock < v_quantity THEN
      RAISE EXCEPTION 'Insufficient stock for "%". Required: %, Available: %.', v_product_name, v_quantity, v_current_stock;
    END IF;

    -- Deduct inventory
    UPDATE public.products
       SET current_stock = current_stock - v_quantity,
           updated_at = timezone('utc'::text, now())
     WHERE id = v_product_id AND user_id = v_user_id;

    -- Insert sale record using authoritative database price
    INSERT INTO public.sales (
      user_id,
      product_id,
      sale_date,
      quantity,
      unit_price,
      source
    ) VALUES (
      v_user_id,
      v_product_id,
      timezone('utc'::text, now()),
      v_quantity,
      v_db_price,
      'retail'
    );

    v_total_items := v_total_items + 1;
    v_total_units := v_total_units + v_quantity;
    v_total_revenue := v_total_revenue + (v_quantity * v_db_price);
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'total_items', v_total_items,
    'total_units', v_total_units,
    'total_revenue', v_total_revenue
  );
END;
$$;

-- Grant execute permissions to authenticated users and service_role
GRANT EXECUTE ON FUNCTION public.create_retail_sale(JSONB) TO authenticated, service_role;
