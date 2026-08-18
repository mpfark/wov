-- fail closed the incomplete cadence run
update combat_config set value = 'off' where key = 'combat_soak';
update combat_config set value = 'maintenance' where key = 'combat_mode';
delete from combat_soak_access;
delete from combat_soak_scopes;
-- withdraw the run session credential
delete from app_secrets where key like 'harness_session_%';
-- one-shot teardown credential for the stranded cadence run
insert into app_secrets (key, value) values ('harness_token_c5s1_20260818a','2ce4e42cc88004217363c088b25d1f19db7a0d2d5f3b395355a4dbf33c7a468a')
on conflict (key) do update set value = excluded.value;