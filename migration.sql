-- FYS upgrade migration (members, officers, blocklist). Safe to run many times. Nothing is dropped or renamed.
-- Supabase > SQL Editor > New query > paste all > Run

-- 1) New columns on members (legacy rows keep NULLs)
alter table public.members
  add column if not exists first_name text,
  add column if not exists middle_name text,
  add column if not exists last_name text,
  add column if not exists date_of_birth date,
  add column if not exists gender text,
  add column if not exists civil_status text,
  add column if not exists category text,
  add column if not exists is_officer boolean not null default false,
  add column if not exists contact_number text,
  add column if not exists email text,
  add column if not exists address text;

-- 2) Check constraints (added only if missing; NULL allowed for legacy rows)
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'members_civil_status_chk') then
    alter table public.members add constraint members_civil_status_chk
      check (civil_status in ('Single','Married','Separated','Widow (Woman)','Widower (Man)'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'members_category_chk') then
    alter table public.members add constraint members_category_chk
      check (category in ('Junior FYS','Senior FYS','Katandaan'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'members_gender_chk') then
    alter table public.members add constraint members_gender_chk check (gender in ('Male','Female'));
  end if;
end $$;

-- 3) Best-effort name backfill for legacy rows (first word / rest)
update public.members
   set first_name = split_part(btrim(full_name), ' ', 1),
       last_name  = nullif(btrim(substr(btrim(full_name), length(split_part(btrim(full_name), ' ', 1)) + 1)), '')
 where first_name is null and last_name is null and full_name is not null;

-- Block only true duplicates (same name AND same email). A parent may register several family
-- members with one email address, so email alone must NOT be unique.
drop index if exists public.members_email_uidx;
create unique index if not exists members_email_name_uidx
  on public.members (lower(email), lower(full_name)) where email is not null;

-- 4) Officers table
create table if not exists public.area4_officers (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id) on delete cascade,
  center text not null,
  position text not null,
  term_start date,
  term_end date,
  committee text,
  created_at timestamptz not null default now()
);

-- Officer type: one row per level (Area / Local). "Both" = two rows with the same position and term.
alter table public.area4_officers add column if not exists officer_level text;
update public.area4_officers set officer_level = 'Area' where officer_level is null;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'area4_officers_level_chk') then
    alter table public.area4_officers add constraint area4_officers_level_chk check (officer_level in ('Area','Local'));
  end if;
  -- the "Status" field was replaced by civil status: the old column must no longer be required
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='members' and column_name='status') then
    alter table public.members alter column status drop not null;
  end if;
end $$;

-- Terms now have an end date (e.g. 2026-2028), so "active = no term_end" no longer works.
-- One holder per (center, position, level, term).
drop index if exists public.area4_officers_center_position_active_idx;
-- Only single-seat positions are unique; Board Member and typed "Others" positions may have several holders.
drop index if exists public.area4_officers_term_uidx;
create unique index area4_officers_term_uidx
  on public.area4_officers (center, position, officer_level, term_start)
  where position in ('President','Vice President','Secretary','Treasurer','Auditor','P.R.O.');

alter table public.area4_officers enable row level security;
drop policy if exists "public can register officer" on public.area4_officers;
drop policy if exists "admin can read officers" on public.area4_officers;
drop policy if exists "admin can update officers" on public.area4_officers;
drop policy if exists "admin can delete officers" on public.area4_officers;
create policy "public can register officer" on public.area4_officers
  for insert to anon, authenticated with check (true);
create policy "admin can read officers" on public.area4_officers
  for select to authenticated using (true);
create policy "admin can update officers" on public.area4_officers
  for update to authenticated using (true) with check (true);
create policy "admin can delete officers" on public.area4_officers
  for delete to authenticated using (true);

-- 5) ATOMIC dual-registration. Anonymous visitors cannot read members (RLS), so the duplicate
-- check and both inserts run here, in ONE transaction: if the officer insert fails, the
-- members insert/update is rolled back automatically.
create or replace function public.register_officer(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare mid uuid; cn text; lv jsonb;
begin
  if jsonb_array_length(coalesce(p->'levels', '[]'::jsonb)) = 0 then raise exception 'NO_OFFICER_LEVEL'; end if;
  select id into mid from public.members
   where lower(full_name) = lower(p->>'full_name')
     and (date_of_birth = nullif(p->>'date_of_birth','')::date
          or (email is not null and lower(email) = lower(coalesce(p->>'email','')))) limit 1;
  -- (same name + same birth date or email = same person; two different people with a common name are not merged)

  if mid is null then
    insert into public.members (full_name, first_name, middle_name, last_name, date_of_birth, gender,
      civil_status, category, age, center, position, spiritual_gift, photo_path, is_officer,
      contact_number, email, address)
    values (p->>'full_name', p->>'first_name', p->>'middle_name', p->>'last_name',
      nullif(p->>'date_of_birth','')::date, p->>'gender', p->>'civil_status', p->>'category',
      nullif(p->>'age','')::int, p->>'center', p->>'o_position', coalesce(nullif(btrim(p->>'spiritual_gift'),''),'None'),
      p->>'photo_path', true, nullif(p->>'contact_number',''), nullif(p->>'email',''), nullif(p->>'address',''))
    returning id into mid;
  else
    update public.members set first_name = p->>'first_name', middle_name = p->>'middle_name',
      last_name = p->>'last_name', date_of_birth = nullif(p->>'date_of_birth','')::date,
      gender = p->>'gender', civil_status = p->>'civil_status', category = p->>'category',
      age = nullif(p->>'age','')::int, center = p->>'center', position = p->>'o_position',
      spiritual_gift = coalesce(nullif(btrim(p->>'spiritual_gift'),''),'None'), photo_path = p->>'photo_path',
      is_officer = true, contact_number = nullif(p->>'contact_number',''),
      address = nullif(p->>'address','')
     where id = mid;
  end if;

  -- p->'levels' = [{"level":"Area","position":"Secretary","committee":null},{"level":"Local","position":"President",...}]
  -- Each officer type has its OWN position, so someone can be Local President and Area Secretary.
  for lv in select * from jsonb_array_elements(p->'levels') loop
    insert into public.area4_officers (member_id, center, position, officer_level, term_start, term_end, committee)
    values (mid, p->>'center', lv->>'position', lv->>'level', nullif(p->>'term_start','')::date,
            nullif(p->>'term_end','')::date, nullif(lv->>'committee',''));
  end loop;
  return mid;
exception when unique_violation then
  get stacked diagnostics cn = constraint_name;
  if cn = 'area4_officers_term_uidx' then raise exception 'DUPLICATE_POSITION|%|%', lv->>'level', lv->>'position';
  else raise exception 'DUPLICATE_EMAIL'; end if;
end $$;

grant execute on function public.register_officer(jsonb) to anon, authenticated;

-- 6) Spelling fix: "Getsimani" -> "Getsemani" (also corrects any rows already saved with the old spelling)
update public.members set center = 'Getsemani' where center = 'Getsimani';
update public.area4_officers set center = 'Getsemani' where center = 'Getsimani';

-- 7) Blocklist: blocked_registrants table, is_blocked() check for the forms, and a trigger that refuses
-- blocked people in the database itself.
create table if not exists public.blocked_registrants (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  date_of_birth date,          -- NULL = block anyone with this exact name
  reason text,
  created_at timestamptz not null default now()
);
create unique index if not exists blocked_registrants_uidx
  on public.blocked_registrants (lower(regexp_replace(btrim(full_name), '\s+', ' ', 'g')), coalesce(date_of_birth, date '0001-01-01'));

-- Only the logged-in admin can see or change the list. Visitors cannot read it.
alter table public.blocked_registrants enable row level security;
drop policy if exists "admin manages blocklist" on public.blocked_registrants;
create policy "admin manages blocklist" on public.blocked_registrants
  for all to authenticated using (true) with check (true);
revoke all on public.blocked_registrants from anon;
grant select, insert, update, delete on public.blocked_registrants to authenticated;

-- Same full name (spaces and capitals ignored) and same birth date. Returns only true/false.
create or replace function public.is_blocked(p_name text, p_dob date) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.blocked_registrants b
     where lower(regexp_replace(btrim(b.full_name), '\s+', ' ', 'g'))
         = lower(regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g'))
       and (b.date_of_birth is null or b.date_of_birth = p_dob));
$$;
grant execute on function public.is_blocked(text, date) to anon, authenticated;

-- Enforced in the database too, so editing the web page in a browser cannot get around it.
-- The logged-in admin is exempt, so admin edits are never refused.
create or replace function public.refuse_blocked_member() returns trigger
language plpgsql security definer set search_path = public as $$
declare r text := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '');
begin
  if r in ('authenticated', 'service_role') then return new; end if;
  if public.is_blocked(new.full_name, new.date_of_birth) then raise exception 'BLOCKED'; end if;
  return new;
end $$;
drop trigger if exists members_refuse_blocked on public.members;
create trigger members_refuse_blocked before insert or update on public.members
  for each row execute function public.refuse_blocked_member();

-- 8) Spiritual gift is now required. Blank/NULL legacy rows become 'None' (the same word the forms store when
-- someone picks None), then the database itself refuses a blank gift. Safe to run many times.
update public.members set spiritual_gift = 'None' where spiritual_gift is null or btrim(spiritual_gift) = '';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'members_spiritual_gift_chk') then
    alter table public.members add constraint members_spiritual_gift_chk
      check (spiritual_gift is not null and btrim(spiritual_gift) <> '');
  end if;
end $$;

-- 9) "Done" lock for the admin page: ticked members marked Done cannot be edited until "Undo done" is pressed.
-- Existing and new registrations start as not done. Safe to run many times.
alter table public.members add column if not exists is_done boolean not null default false;
