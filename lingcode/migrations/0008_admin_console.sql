-- Admin console: billing plans, token balances and ledger, AI usage metering,
-- support tickets, admin team, audit log and governance settings.
-- Every statement is idempotent. Each new table gets the app_all policy in this
-- same migration (see 0005: without it the app role cannot insert).

ALTER TABLE app_users ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS status_reason text NOT NULL DEFAULT '';
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;

CREATE TABLE IF NOT EXISTS billing_plans (
  id text PRIMARY KEY,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  price_cents integer NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'usd',
  monthly_tokens bigint NOT NULL DEFAULT 0,
  features jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_default boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  sort integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO billing_plans (id, name, description, price_cents, monthly_tokens, features, is_default, sort) VALUES
  ('free', 'Free', 'Try every tool with a small monthly allowance.', 0, 250000, '["All tools","250K tokens / month"]'::jsonb, true, 0),
  ('creator', 'Creator', 'For one channel posting every week.', 1900, 8000000, '["8M tokens / month","Automation agents","Priority queue"]'::jsonb, false, 1),
  ('pro', 'Pro', 'For creators running several channels.', 4900, 25000000, '["25M tokens / month","Everything in Creator","Video generation"]'::jsonb, false, 2),
  ('studio', 'Studio', 'For teams producing at volume.', 14900, 80000000, '["80M tokens / month","Everything in Pro","Dedicated support"]'::jsonb, false, 3)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS billing_accounts (
  user_id text PRIMARY KEY REFERENCES app_users(id) ON DELETE CASCADE,
  plan_id text NOT NULL REFERENCES billing_plans(id),
  status text NOT NULL DEFAULT 'active',
  period_start timestamptz NOT NULL DEFAULT now(),
  period_end timestamptz NOT NULL DEFAULT now() + interval '1 month',
  allowance_remaining bigint NOT NULL DEFAULT 0,
  bonus_balance bigint NOT NULL DEFAULT 0,
  unlimited boolean NOT NULL DEFAULT false,
  payment_provider text NOT NULL DEFAULT 'manual',
  payment_ref text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS token_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  kind text NOT NULL,
  tokens bigint NOT NULL,
  balance_after bigint NOT NULL DEFAULT 0,
  reference text NOT NULL DEFAULT '',
  actor text NOT NULL DEFAULT 'system',
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS token_ledger_user_idx ON token_ledger(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS token_ledger_created_idx ON token_ledger(created_at DESC);

CREATE TABLE IF NOT EXISTS ai_usage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text,
  provider text NOT NULL,
  model text NOT NULL DEFAULT '',
  operation text NOT NULL DEFAULT 'chat',
  feature text NOT NULL DEFAULT '',
  input_tokens bigint NOT NULL DEFAULT 0,
  output_tokens bigint NOT NULL DEFAULT 0,
  cost_usd numeric(14, 6) NOT NULL DEFAULT 0,
  cost_estimated boolean NOT NULL DEFAULT false,
  tokens_charged bigint NOT NULL DEFAULT 0,
  request_ref text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_usage_events_created_idx ON ai_usage_events(created_at DESC);
CREATE INDEX IF NOT EXISTS ai_usage_events_user_idx ON ai_usage_events(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS support_tickets (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  subject text NOT NULL,
  category text NOT NULL DEFAULT 'general',
  status text NOT NULL DEFAULT 'open',
  priority text NOT NULL DEFAULT 'normal',
  assigned_to text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_message_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS support_tickets_status_idx ON support_tickets(status, last_message_at DESC);
CREATE INDEX IF NOT EXISTS support_tickets_user_idx ON support_tickets(user_id, last_message_at DESC);

CREATE TABLE IF NOT EXISTS support_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id text NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  author_type text NOT NULL,
  author_email text NOT NULL DEFAULT '',
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS support_messages_ticket_idx ON support_messages(ticket_id, created_at);

CREATE TABLE IF NOT EXISTS admin_members (
  email text PRIMARY KEY,
  role text NOT NULL DEFAULT 'viewer',
  added_by text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS admin_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_email text NOT NULL,
  action text NOT NULL,
  target_type text NOT NULL DEFAULT '',
  target_id text NOT NULL DEFAULT '',
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS admin_audit_log_created_idx ON admin_audit_log(created_at DESC);

CREATE TABLE IF NOT EXISTS app_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE billing_plans ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS app_all ON billing_plans;
CREATE POLICY app_all ON billing_plans FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE billing_accounts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS app_all ON billing_accounts;
CREATE POLICY app_all ON billing_accounts FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE token_ledger ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS app_all ON token_ledger;
CREATE POLICY app_all ON token_ledger FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE ai_usage_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS app_all ON ai_usage_events;
CREATE POLICY app_all ON ai_usage_events FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE support_tickets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS app_all ON support_tickets;
CREATE POLICY app_all ON support_tickets FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE support_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS app_all ON support_messages;
CREATE POLICY app_all ON support_messages FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE admin_members ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS app_all ON admin_members;
CREATE POLICY app_all ON admin_members FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE admin_audit_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS app_all ON admin_audit_log;
CREATE POLICY app_all ON admin_audit_log FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS app_all ON app_settings;
CREATE POLICY app_all ON app_settings FOR ALL USING (true) WITH CHECK (true);
