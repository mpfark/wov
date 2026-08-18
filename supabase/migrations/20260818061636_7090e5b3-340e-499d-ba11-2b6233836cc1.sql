insert into public.app_secrets(key, value) values
 ('harness_token_c5p20260818b','1b57b1506449df64fb10d89f024cc1f9ac773e682e4b434e0db02a777ce18615'),
 ('harness_token_c5t20260818b','9c2e2d1f4eba1c601b102ccfaec2b70e2f57d674ea83d2b091393f2623ea7a2e')
on conflict (key) do update set value = excluded.value;