delete from public.harness_run_registry where run_id in ('c5td_20260818a','c5s3_20260818a');
delete from public.app_secrets where key like 'harness_%';