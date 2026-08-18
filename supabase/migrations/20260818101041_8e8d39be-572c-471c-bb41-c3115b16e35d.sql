insert into app_secrets (key, value) values ('harness_token_c5s2_20260818a','85a4bc9652dcea6915a4b67c7a35d8f7bff2996ade57445d34dc5e77fa0fcdc4')
on conflict (key) do update set value = excluded.value;