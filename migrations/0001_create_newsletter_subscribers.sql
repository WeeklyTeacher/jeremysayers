-- /home/r_/projects/jeremysayers/migrations/0001_create_newsletter_subscribers.sql
CREATE TABLE IF NOT EXISTS newsletter_subscribers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  first_name TEXT,
  last_name TEXT,
  email TEXT NOT NULL UNIQUE,
  interests TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
