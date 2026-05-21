update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role":"admin"}'::jsonb
where id = (
  select id
  from auth.users
  order by created_at asc
  limit 1
);

select
  email,
  raw_app_meta_data
from auth.users
order by created_at asc
limit 1;
