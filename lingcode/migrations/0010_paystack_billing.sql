-- Payment orders record the quoted price before redirecting to Paystack.
-- Only a verified successful transaction may move an order to paid and grant credits.
CREATE TABLE IF NOT EXISTS billing_orders (
  reference text PRIMARY KEY,
  user_id text NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind IN ('plan', 'credits')),
  plan_id text REFERENCES billing_plans(id),
  credits_tokens bigint NOT NULL DEFAULT 0,
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  currency text NOT NULL DEFAULT 'USD',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'failed', 'refunded')),
  provider text NOT NULL DEFAULT 'paystack',
  provider_payment_id text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS billing_orders_user_idx ON billing_orders(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS billing_orders_paid_idx ON billing_orders(paid_at DESC) WHERE status = 'paid';
ALTER TABLE billing_orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS app_all ON billing_orders;
CREATE POLICY app_all ON billing_orders FOR ALL USING (true) WITH CHECK (true);
