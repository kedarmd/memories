ALTER TABLE checkpoints ADD COLUMN coverage TEXT NOT NULL DEFAULT '{"status":"unknown","notes":"Migration backfill; coverage was not recorded."}';
ALTER TABLE checkpoints ADD COLUMN sources TEXT NOT NULL DEFAULT '[]';
