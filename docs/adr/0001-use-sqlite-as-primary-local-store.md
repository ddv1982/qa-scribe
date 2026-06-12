# Use SQLite as the primary local store

qa-scribe will use SQLite as its primary local store instead of a JSON document format. SQLite fits the app's local-first desktop model because Sessions contain many related objects, need incremental atomic saves, and should remain queryable, portable, and private without requiring a server; encryption-at-rest remains a planned privacy hardening step rather than a blocker for the first MVP.
