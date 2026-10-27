-- Shared dashboards are readable only by their unguessable UUID through the
-- get_shared_dashboard RPC. The browser role has no direct table read/update/delete.
create table if not exists public.saved_dashboards (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  dataset jsonb not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint saved_dashboards_title_length check (char_length(title) between 1 and 120),
  constraint saved_dashboards_dataset_object check (jsonb_typeof(dataset) = 'object'),
  constraint saved_dashboards_dataset_size check (octet_length(dataset::text) <= 1500000),
  constraint saved_dashboards_metadata_object check (jsonb_typeof(metadata) = 'object'),
  constraint saved_dashboards_metadata_size check (octet_length(metadata::text) <= 16000)
);

alter table public.saved_dashboards enable row level security;
revoke all on table public.saved_dashboards from public, anon, authenticated;
grant usage on schema public to anon;

drop policy if exists "deny direct client access" on public.saved_dashboards;
create policy "deny direct client access"
  on public.saved_dashboards
  for all
  to anon, authenticated
  using (false)
  with check (false);

create or replace function public.create_shared_dashboard(
  p_id uuid,
  p_title text,
  p_dataset jsonb,
  p_metadata jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_id is null then
    raise exception 'Dashboard ID is required.' using errcode = '22023';
  end if;
  if p_title is null or char_length(p_title) not between 1 and 120 then
    raise exception 'Dashboard title must be between 1 and 120 characters.' using errcode = '22023';
  end if;
  if jsonb_typeof(p_dataset) is distinct from 'object'
     or jsonb_typeof(p_dataset -> 'headers') is distinct from 'array'
     or jsonb_typeof(p_dataset -> 'rows') is distinct from 'array' then
    raise exception 'Dataset must contain header and row arrays.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_dataset -> 'headers') not between 1 and 100
     or jsonb_array_length(p_dataset -> 'rows') not between 1 and 10000 then
    raise exception 'Dataset exceeds the dashboard row or column limit.' using errcode = '22023';
  end if;
  if octet_length(p_dataset::text) > 1500000 then
    raise exception 'Dataset is too large to share (1.5 MB limit). Use a smaller CSV.' using errcode = '22023';
  end if;
  if p_metadata is null or jsonb_typeof(p_metadata) is distinct from 'object'
     or octet_length(p_metadata::text) > 16000 then
    raise exception 'Dashboard metadata is invalid or too large.' using errcode = '22023';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_dataset -> 'headers') as header_item(value)
    where jsonb_typeof(header_item.value) is distinct from 'string'
       or header_item.value = '""'::jsonb
  ) then
    raise exception 'Dataset headers must be non-empty strings.' using errcode = '22023';
  end if;
  if (select count(distinct value) from jsonb_array_elements_text(p_dataset -> 'headers') as h(value))
     <> jsonb_array_length(p_dataset -> 'headers') then
    raise exception 'Dataset headers must be unique.' using errcode = '22023';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_dataset -> 'rows') as row_item(value)
    where jsonb_typeof(row_item.value) is distinct from 'object'
  ) then
    raise exception 'Dataset rows must be objects.' using errcode = '22023';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_dataset -> 'rows') as row_item(value)
    cross join jsonb_array_elements_text(p_dataset -> 'headers') as header_item(name)
    where jsonb_typeof(row_item.value -> header_item.name) is distinct from 'string'
  ) then
    raise exception 'Dataset cells must be strings for every header.' using errcode = '22023';
  end if;

  insert into public.saved_dashboards (id, title, dataset, metadata)
  values (p_id, p_title, p_dataset, p_metadata);
  return p_id;
end;
$$;

create or replace function public.get_shared_dashboard(p_id uuid)
returns table (
  id uuid,
  title text,
  dataset jsonb,
  metadata jsonb,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select d.id, d.title, d.dataset, d.metadata, d.created_at
  from public.saved_dashboards as d
  where d.id = p_id
  limit 1;
$$;

revoke all on function public.create_shared_dashboard(uuid, text, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.get_shared_dashboard(uuid) from public, anon, authenticated;
grant execute on function public.create_shared_dashboard(uuid, text, jsonb, jsonb) to anon;
grant execute on function public.get_shared_dashboard(uuid) to anon;
