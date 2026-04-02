-- /home/r_/projects/jeremysayers/migrations/0002_newsletter_double_opt_in.sql
PRAGMA foreign_keys=OFF;

ALTER TABLE newsletter_subscribers RENAME TO newsletter_subscribers_legacy;

CREATE TABLE newsletter_subscribers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  email_normalized TEXT NOT NULL,
  first_name TEXT,
  last_name TEXT,
  interests TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'unsubscribed', 'bounced', 'complained')),
  source_page TEXT,
  signup_ip_hash TEXT,
  signup_user_agent TEXT,
  created_at TEXT NOT NULL,
  confirm_token TEXT,
  confirm_token_expires_at TEXT,
  confirmed_at TEXT,
  unsubscribe_token TEXT,
  unsubscribe_at TEXT,
  suppressed_reason TEXT,
  last_email_sent_at TEXT
);

INSERT INTO newsletter_subscribers (
  id,
  email,
  email_normalized,
  first_name,
  last_name,
  interests,
  status,
  source_page,
  signup_ip_hash,
  signup_user_agent,
  created_at,
  confirm_token,
  confirm_token_expires_at,
  confirmed_at,
  unsubscribe_token,
  unsubscribe_at,
  suppressed_reason,
  last_email_sent_at
)
SELECT
  id,
  lower(email),
  lower(email),
  first_name,
  last_name,
  interests,
  'active',
  NULL,
  NULL,
  NULL,
  COALESCE(created_at, CURRENT_TIMESTAMP),
  NULL,
  NULL,
  COALESCE(created_at, CURRENT_TIMESTAMP),
  lower(hex(randomblob(32))),
  NULL,
  NULL,
  NULL
FROM newsletter_subscribers_legacy;

DROP TABLE newsletter_subscribers_legacy;

CREATE UNIQUE INDEX idx_newsletter_subscribers_email_normalized
  ON newsletter_subscribers(email_normalized);

CREATE INDEX idx_newsletter_subscribers_confirm_token
  ON newsletter_subscribers(confirm_token);

CREATE INDEX idx_newsletter_subscribers_unsubscribe_token
  ON newsletter_subscribers(unsubscribe_token);

CREATE INDEX idx_newsletter_subscribers_status
  ON newsletter_subscribers(status);

PRAGMA foreign_keys=ON;
