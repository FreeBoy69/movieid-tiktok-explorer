-- User-owned manuscripts, ebook artwork, and reader-ready chapter drafts.
CREATE TABLE IF NOT EXISTS creator_digital_products (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  title text NOT NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS creator_digital_products_user_updated_idx
  ON creator_digital_products(user_id, updated_at DESC);
