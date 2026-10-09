-- "Request access" on the invite-only screen: one row per person, read and approved from the SQL editor.
-- No grants on the table; the two RPCs only ever touch the caller's own row.

create table public.access_requests (
  user_id      uuid        primary key references auth.users on delete cascade,
  requested_at timestamptz not null default now()
);
alter table public.access_requests enable row level security;
revoke all on public.access_requests from public, anon, authenticated;

-- Asks for access. Does nothing for people who already have it; asking twice keeps the first time.
create function public.request_access()
returns timestamptz
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_at timestamptz;
begin
  if auth.uid() is null then
    raise exception 'sign in first';
  end if;
  if public.site_has_access() then
    return null;
  end if;
  insert into public.access_requests (user_id) values (auth.uid())
  on conflict (user_id) do nothing;
  select requested_at into v_at from public.access_requests where user_id = auth.uid();
  return v_at;
end;
$$;

-- When the caller asked, or null.
create function public.my_access_request()
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select requested_at from public.access_requests where user_id = auth.uid();
$$;

-- Approving someone (allowlist insert) clears their request.
create function public.access_request_granted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.access_requests where user_id = new.user_id;
  return new;
end;
$$;

create trigger site_access_clears_request
after insert on public.site_access
for each row execute function public.access_request_granted();

revoke all on function public.request_access() from public, anon;
revoke all on function public.my_access_request() from public, anon;
revoke all on function public.access_request_granted() from public, anon, authenticated;
grant execute on function public.request_access() to authenticated;
grant execute on function public.my_access_request() to authenticated;
