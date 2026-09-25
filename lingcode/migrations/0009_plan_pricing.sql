-- Plan prices are derived from their token allowance: the provider cost of the
-- tokens plus the company's profit margin. price_mode 'auto' keeps price_cents
-- in sync with that formula; 'manual' (the free plan, promos) keeps a fixed price.
-- margin_percent overrides the global margin for one plan. Existing plan
-- prices are manual so a deployment never changes customer-facing prices.
-- Admins can opt individual plans into automatic pricing after reviewing them.
-- Idempotent.

ALTER TABLE billing_plans ADD COLUMN IF NOT EXISTS price_mode text NOT NULL DEFAULT 'manual';
ALTER TABLE billing_plans ADD COLUMN IF NOT EXISTS margin_percent numeric(7, 2);
