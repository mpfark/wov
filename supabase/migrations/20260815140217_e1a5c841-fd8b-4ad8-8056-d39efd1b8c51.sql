insert into public.app_secrets (key, value)
values ('c5_validation_token', '420727cf55ba4b2faa6adf2546fdc322edee9dd94f43451191f0da1b6c569df1')
on conflict (key) do update set value = excluded.value;