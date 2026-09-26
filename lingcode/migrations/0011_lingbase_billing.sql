-- LingBase recurring checkout and paid-only onboarding. No credits are granted
-- until AutoYT verifies a paid LingBase order for the same signed-in user.
ALTER TABLE billing_plans ADD COLUMN IF NOT EXISTS annual_price_cents integer NOT NULL DEFAULT 0;
ALTER TABLE billing_accounts ADD COLUMN IF NOT EXISTS subscription_interval text NOT NULL DEFAULT 'month';
ALTER TABLE billing_accounts ADD COLUMN IF NOT EXISTS subscription_paid_through timestamptz;
ALTER TABLE billing_accounts ADD COLUMN IF NOT EXISTS billing_verified_at timestamptz;
ALTER TABLE billing_accounts ADD COLUMN IF NOT EXISTS lingbase_user_id text NOT NULL DEFAULT '';
ALTER TABLE billing_orders ADD COLUMN IF NOT EXISTS "interval" text NOT NULL DEFAULT 'month';
ALTER TABLE billing_orders ADD COLUMN IF NOT EXISTS provider_order_id text NOT NULL DEFAULT '';
ALTER TABLE billing_orders ADD COLUMN IF NOT EXISTS provider_price_id text NOT NULL DEFAULT '';
CREATE UNIQUE INDEX IF NOT EXISTS billing_orders_lingbase_order_idx ON billing_orders(provider_order_id) WHERE provider_order_id <> '';

INSERT INTO billing_plans (id, name, description, price_cents, monthly_tokens, features, is_default, active, sort)
VALUES ('pending', 'Choose a plan', 'Select a paid plan to start creating.', 0, 0, '[]'::jsonb, true, true, -1)
ON CONFLICT (id) DO UPDATE SET monthly_tokens = 0, price_cents = 0, is_default = true, active = true;

UPDATE billing_plans SET is_default = false, active = false, monthly_tokens = 0
WHERE id = 'free';
UPDATE billing_plans SET price_cents = 1900, annual_price_cents = 20599,
  description = '80,000 credits each month for AI creation tools.',
  features = '["80,000 credits monthly","All creation tools","Automation agents"]'::jsonb
WHERE id = 'creator';
UPDATE billing_plans SET price_cents = 5900, annual_price_cents = 63799,
  description = '250,000 credits each month for creators managing several channels.',
  features = '["250,000 credits monthly","Everything in Creator","Priority generation"]'::jsonb
WHERE id = 'pro';
UPDATE billing_plans SET price_cents = 18900, annual_price_cents = 204199,
  description = '800,000 credits each month for teams producing at volume.',
  features = '["800,000 credits monthly","Everything in Pro","Team production"]'::jsonb
WHERE id = 'studio';

UPDATE billing_accounts SET plan_id = 'pending', allowance_remaining = 0,
  status = 'pending', payment_provider = 'manual', updated_at = now()
WHERE plan_id = 'free' AND NOT unlimited;
