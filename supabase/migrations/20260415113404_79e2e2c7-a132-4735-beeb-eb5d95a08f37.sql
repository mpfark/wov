ALTER TABLE regions ADD COLUMN illustration_url text DEFAULT '';
ALTER TABLE regions ADD COLUMN illustration_metadata jsonb DEFAULT '{}'::jsonb;

ALTER TABLE areas ADD COLUMN illustration_url text DEFAULT '';
ALTER TABLE areas ADD COLUMN illustration_metadata jsonb DEFAULT '{}'::jsonb;

ALTER TABLE nodes ADD COLUMN illustration_url text DEFAULT '';
ALTER TABLE nodes ADD COLUMN illustration_metadata jsonb DEFAULT '{}'::jsonb;