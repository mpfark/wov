delete from public.app_secrets where key like 'harness_token_%' or key like 'harness_session_%';
delete from public.harness_run_registry;