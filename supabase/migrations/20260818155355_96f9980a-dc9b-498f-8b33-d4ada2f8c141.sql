insert into public.harness_run_registry (run_id, kind, entity_id, entity_text) values
 ('c5td_20260818a','deadline',null,(now() - interval '1 hour')::text),
 ('c5td_20260818a','auth_user','e5660d12-8ffd-4dbd-815e-721944a5f895','c5s2_20260818a@harness.invalid'),
 ('c5td_20260818a','character','f2077892-f968-42fe-b416-295f6044edef',null),
 ('c5td_20260818a','node_ref','dce5d68c-e7e0-4796-9f6c-ff11da41b00d',null);
insert into public.harness_run_registry (run_id, kind, entity_id)
 select 'c5td_20260818a','creature', c.id from public.creatures c where c.node_id = 'dce5d68c-e7e0-4796-9f6c-ff11da41b00d';
delete from public.app_secrets where key = 'harness_session_c5s2_20260818a';
insert into public.app_secrets (key, value) values
 ('harness_token_c5td_20260818a','1f73bd1fc0604c9ccf16001e4024f95759507afe69c9b187dc22b31f99a6b168'),
 ('harness_token_c5s3_20260818a','0dbe4a9cd7268b1f3cc386bf9751ca69199948194c64c0decfa2a976b5ab8710')
 on conflict (key) do update set value = excluded.value;