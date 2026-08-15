insert into public.app_secrets (key, value) values ('c5_validation_token', '03edd75e4beae05535668f1cab96de8360863dd056d019ebb6dd04515db7ac5a')
on conflict (key) do update set value = excluded.value;