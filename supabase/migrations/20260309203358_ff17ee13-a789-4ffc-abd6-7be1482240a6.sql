ALTER TABLE creatures DROP CONSTRAINT creatures_ac_range;
ALTER TABLE creatures ADD CONSTRAINT creatures_ac_range CHECK (ac >= 0 AND ac <= 100);