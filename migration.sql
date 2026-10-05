-- FYS upgrade migration. Safe to run many times. Nothing is dropped or renamed.
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

-- PER-CENTER uniqueness: each center has its own officers, so the same position may exist
-- at different centers. Only one ACTIVE (no term_end) holder per (center, position).
create unique index if not exists area4_officers_center_position_active_idx
  on public.area4_officers (center, position) where term_end is null;

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
declare mid uuid; cn text;
begin
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
      nullif(p->>'age','')::int, p->>'center', p->>'o_position', coalesce(p->>'spiritual_gift','None'),
      p->>'photo_path', true, nullif(p->>'contact_number',''), nullif(p->>'email',''), nullif(p->>'address',''))
    returning id into mid;
  else
    update public.members set first_name = p->>'first_name', middle_name = p->>'middle_name',
      last_name = p->>'last_name', date_of_birth = nullif(p->>'date_of_birth','')::date,
      gender = p->>'gender', civil_status = p->>'civil_status', category = p->>'category',
      age = nullif(p->>'age','')::int, center = p->>'center', position = p->>'o_position',
      spiritual_gift = coalesce(p->>'spiritual_gift','None'), photo_path = p->>'photo_path',
      is_officer = true, contact_number = nullif(p->>'contact_number',''),
      address = nullif(p->>'address','')
     where id = mid;
  end if;

  insert into public.area4_officers (member_id, center, position, term_start, term_end, committee)
  values (mid, p->>'center', p->>'o_position', nullif(p->>'term_start','')::date,
          nullif(p->>'term_end','')::date, nullif(p->>'committee',''));
  return mid;
exception when unique_violation then
  get stacked diagnostics cn = constraint_name;
  if cn = 'area4_officers_center_position_active_idx' then raise exception 'DUPLICATE_POSITION';
  else raise exception 'DUPLICATE_EMAIL'; end if;
end $$;

grant execute on function public.register_officer(jsonb) to anon, authenticated;

-- 6) Spelling fix: "Getsimani" -> "Getsemani" (also corrects any rows already saved with the old spelling)
update public.members set center = 'Getsemani' where center = 'Getsimani';
update public.area4_officers set center = 'Getsemani' where center = 'Getsimani';
