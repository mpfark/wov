ALTER TABLE public.ai_credit_drain_item_log ALTER COLUMN node_id DROP NOT NULL;
ALTER TABLE public.ai_credit_drain_item_log ADD COLUMN IF NOT EXISTS area_id uuid;
ALTER TABLE public.ai_credit_drain_item_log ADD COLUMN IF NOT EXISTS target_type text NOT NULL DEFAULT 'node';