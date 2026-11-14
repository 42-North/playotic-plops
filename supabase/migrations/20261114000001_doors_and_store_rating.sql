-- Playotic Plops, migration 2 (2026-11-14)
--   1. More stall-door options. The old single "full_doors" value becomes "full_height".
--        gaps         standard stall with gaps around the door
--        no_gaps      nearly full door with no gaps (better than standard, not floor-to-ceiling)
--        full_height  full floor-to-ceiling stall, Buc-ee's style
--        single_user  private single-user room
--        unknown      not reported
--   2. Optional food & store bonus rating (1-5). Shown separately; never part of any plop score.
--      Its average covers every visible rating that includes one (original and crowd alike).
-- Safe to run once on a database that already has migration 1. Existing ratings are kept.

begin;

-- 1. Door options --------------------------------------------------------------
alter table private.ratings drop constraint if exists ratings_stall_privacy_check;
update private.ratings set stall_privacy = 'full_height' where stall_privacy = 'full_doors';
alter table private.ratings add constraint ratings_stall_privacy_check
  check (stall_privacy in ('gaps', 'no_gaps', 'full_height', 'single_user', 'unknown'));

-- 2. Food & store bonus rating -------------------------------------------------
alter table private.ratings add column if not exists store_rating smallint
  check (store_rating is null or store_rating between 1 and 5);

-- Public summary view: same columns as before, plus the bonus aggregate at the end.
create or replace view private.stop_public as
select
  s.id, s.name, s.category, s.address, s.lat, s.lng, s.status, s.created_at,
  o.rating                                   as original_rating,
  o.visit_date                               as original_visit_date,
  case when o.id is null then 0 else coalesce(v.agree_count, 0) end::int    as agree_count,
  case when o.id is null then 0 else coalesce(v.disagree_count, 0) end::int as disagree_count,
  coalesce(c.crowd_count, 0)::int            as crowd_count,
  c.crowd_avg,
  f.last_visit_date,
  f.last_rated_at,
  lc.cleanliness,   lc.visit_date as cleanliness_visit_date,
  lp.stall_privacy, lp.visit_date as stall_privacy_visit_date,
  lk.key_required,  lk.visit_date as key_required_visit_date,
  lf.food,          lf.visit_date as food_visit_date,
  coalesce(sr.store_count, 0)::int           as store_count,
  sr.store_avg
from private.stops s
left join private.ratings o
  on o.stop_id = s.id and o.is_original and o.status = 'visible'
left join lateral (
  select count(*) filter (where av.agrees) as agree_count,
         count(*) filter (where not av.agrees) as disagree_count
  from private.agreement_votes av
  where av.stop_id = s.id and av.status = 'visible'
) v on true
left join lateral (
  select count(*) as crowd_count, round(avg(r.rating)::numeric, 1) as crowd_avg
  from private.ratings r
  where r.stop_id = s.id and not r.is_original and r.status = 'visible'
) c on true
left join lateral (
  select max(r.visit_date) as last_visit_date, max(r.updated_at) as last_rated_at
  from private.ratings r where r.stop_id = s.id and r.status = 'visible'
) f on true
left join lateral (
  select r.cleanliness, r.visit_date from private.ratings r
  where r.stop_id = s.id and r.status = 'visible' and r.cleanliness <> 'unknown'
  order by r.visit_date desc, r.updated_at desc limit 1
) lc on true
left join lateral (
  select r.stall_privacy, r.visit_date from private.ratings r
  where r.stop_id = s.id and r.status = 'visible' and r.stall_privacy <> 'unknown'
  order by r.visit_date desc, r.updated_at desc limit 1
) lp on true
left join lateral (
  select r.key_required, r.visit_date from private.ratings r
  where r.stop_id = s.id and r.status = 'visible' and r.key_required <> 'unknown'
  order by r.visit_date desc, r.updated_at desc limit 1
) lk on true
left join lateral (
  select r.food, r.visit_date from private.ratings r
  where r.stop_id = s.id and r.status = 'visible' and r.food <> 'unknown'
  order by r.visit_date desc, r.updated_at desc limit 1
) lf on true
left join lateral (
  select count(r.store_rating) as store_count, round(avg(r.store_rating)::numeric, 1) as store_avg
  from private.ratings r
  where r.stop_id = s.id and r.status = 'visible' and r.store_rating is not null
) sr on true
where s.status <> 'hidden';

revoke all on private.stop_public from public;

-- Read functions whose result columns change must be dropped and recreated.
drop function if exists public.stops_in_bbox(double precision, double precision, double precision, double precision, boolean, integer);
drop function if exists public.stops_in_boxes(jsonb, integer);

create function public.stops_in_bbox(
  p_south double precision, p_west double precision,
  p_north double precision, p_east double precision,
  p_include_closed boolean default false,
  p_limit integer default 200
)
returns table (
  id uuid, name text, category text, address text, lat double precision, lng double precision,
  status text, created_at timestamptz,
  original_rating smallint, original_visit_date date, agree_count int, disagree_count int,
  crowd_count int, crowd_avg numeric, last_visit_date date, last_rated_at timestamptz,
  cleanliness text, cleanliness_visit_date date, stall_privacy text, stall_privacy_visit_date date,
  key_required text, key_required_visit_date date, food text, food_visit_date date,
  store_count int, store_avg numeric
)
language sql stable security definer
set search_path = ''
as $$
  select sp.id, sp.name, sp.category, sp.address, sp.lat, sp.lng, sp.status, sp.created_at,
         sp.original_rating, sp.original_visit_date, sp.agree_count, sp.disagree_count,
         sp.crowd_count, sp.crowd_avg, sp.last_visit_date, sp.last_rated_at,
         sp.cleanliness, sp.cleanliness_visit_date, sp.stall_privacy, sp.stall_privacy_visit_date,
         sp.key_required, sp.key_required_visit_date, sp.food, sp.food_visit_date,
         sp.store_count, sp.store_avg
  from private.stop_public sp
  where p_south is not null and p_north is not null and p_west is not null and p_east is not null
    and p_north >= p_south
    and p_north - p_south <= 30
    and sp.lat between p_south and p_north
    and (case when p_west <= p_east then sp.lng between p_west and p_east
              else (sp.lng >= p_west or sp.lng <= p_east) end)
    and (p_include_closed or sp.status = 'active')
  order by private.distance_m(sp.lat, sp.lng, (p_south + p_north) / 2, (p_west + p_east) / 2)
  limit greatest(1, least(coalesce(p_limit, 200), 300));
$$;

create function public.stops_in_boxes(p_boxes jsonb, p_limit integer default 300)
returns table (
  id uuid, name text, category text, address text, lat double precision, lng double precision,
  status text, created_at timestamptz,
  original_rating smallint, original_visit_date date, agree_count int, disagree_count int,
  crowd_count int, crowd_avg numeric, last_visit_date date, last_rated_at timestamptz,
  cleanliness text, cleanliness_visit_date date, stall_privacy text, stall_privacy_visit_date date,
  key_required text, key_required_visit_date date, food text, food_visit_date date,
  store_count int, store_avg numeric
)
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if p_boxes is null or jsonb_typeof(p_boxes) <> 'array' or jsonb_array_length(p_boxes) = 0
     or jsonb_array_length(p_boxes) > 40 then
    raise exception 'p_boxes must be an array of 1-40 boxes' using errcode = '22023';
  end if;
  return query
  with boxes as (
    select (b->>0)::double precision as s, (b->>1)::double precision as w,
           (b->>2)::double precision as n, (b->>3)::double precision as e
    from jsonb_array_elements(p_boxes) b
  ), valid as (
    select * from boxes where n >= s and n - s <= 5 and e >= w and e - w <= 5
  )
  select sp.id, sp.name, sp.category, sp.address, sp.lat, sp.lng, sp.status, sp.created_at,
         sp.original_rating, sp.original_visit_date, sp.agree_count, sp.disagree_count,
         sp.crowd_count, sp.crowd_avg, sp.last_visit_date, sp.last_rated_at,
         sp.cleanliness, sp.cleanliness_visit_date, sp.stall_privacy, sp.stall_privacy_visit_date,
         sp.key_required, sp.key_required_visit_date, sp.food, sp.food_visit_date,
         sp.store_count, sp.store_avg
  from private.stop_public sp
  where sp.status = 'active'
    and exists (select 1 from valid v where sp.lat between v.s and v.n and sp.lng between v.w and v.e)
  limit greatest(1, least(coalesce(p_limit, 300), 500));
end $$;

-- Detail: recent ratings now include the bonus rating. (Aggregates come from the view.)
create or replace function public.stop_detail(p_stop_id uuid)
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select case when sp.id is null then null else
    to_jsonb(sp) || jsonb_build_object(
      'tallies', (
        select jsonb_build_object(
          'cleanliness',   (select coalesce(jsonb_object_agg(k, n), '{}'::jsonb) from (select r.cleanliness k, count(*) n from private.ratings r where r.stop_id = sp.id and r.status = 'visible' and r.cleanliness <> 'unknown' group by 1) t),
          'stall_privacy', (select coalesce(jsonb_object_agg(k, n), '{}'::jsonb) from (select r.stall_privacy k, count(*) n from private.ratings r where r.stop_id = sp.id and r.status = 'visible' and r.stall_privacy <> 'unknown' group by 1) t),
          'key_required',  (select coalesce(jsonb_object_agg(k, n), '{}'::jsonb) from (select r.key_required k, count(*) n from private.ratings r where r.stop_id = sp.id and r.status = 'visible' and r.key_required <> 'unknown' group by 1) t),
          'food',          (select coalesce(jsonb_object_agg(k, n), '{}'::jsonb) from (select r.food k, count(*) n from private.ratings r where r.stop_id = sp.id and r.status = 'visible' and r.food <> 'unknown' group by 1) t)
        )
      ),
      'recent_ratings', (
        select coalesce(jsonb_agg(x order by x.visit_date desc, x.updated_at desc), '[]'::jsonb) from (
          select r.id, r.is_original, r.rating, r.cleanliness, r.stall_privacy, r.key_required, r.food,
                 r.store_rating, r.restroom, r.comment, r.visit_date, r.created_at, r.updated_at
          from private.ratings r
          where r.stop_id = sp.id and r.status = 'visible'
          order by r.visit_date desc, r.updated_at desc
          limit 25
        ) x
      )
    )
  end
  from (select 1) one
  left join private.stop_public sp on sp.id = p_stop_id;
$$;

-- Write functions gain a trailing p_store_rating parameter (defaults to null).
drop function if exists public.api_create_stop(text, text, text, text, double precision, double precision, boolean, smallint, text, text, text, text, text, text, date);
drop function if exists public.api_submit_rating(text, uuid, smallint, text, text, text, text, text, text, date);

create or replace function public.api_create_stop(
  p_contributor text,
  p_name text, p_category text, p_address text, p_lat double precision, p_lng double precision,
  p_confirm_distinct boolean,
  p_rating smallint, p_cleanliness text, p_stall_privacy text, p_key_required text, p_food text,
  p_restroom text, p_comment text, p_visit_date date,
  p_store_rating smallint default null
)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  who bytea := private.decode_hash(p_contributor);
  new_id uuid;
  nm text := private.clean_text(p_name);
  addr text := private.clean_text(p_address);
  candidates jsonb;
begin
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    return jsonb_build_object('ok', false, 'code', 'invalid_location', 'message', 'Pick a valid map position.');
  end if;
  perform private.validate_visit_date(p_visit_date);

  -- Serialize creations in the same ~1 km grid area so concurrent duplicates cannot both pass.
  perform pg_advisory_xact_lock(hashtextextended('stop-cell:' || round(p_lat::numeric, 2) || ':' || round(p_lng::numeric, 2), 0));

  if exists (
    select 1 from public.stops_near(p_lat, p_lng, 60) n
    where private.normalize_name(n.name) = private.normalize_name(nm)
  ) then
    return jsonb_build_object('ok', false, 'code', 'duplicate',
      'message', 'This stop already exists. Rate the existing stop instead.',
      'candidates', (select jsonb_agg(to_jsonb(n)) from public.stops_near(p_lat, p_lng, 60) n));
  end if;

  select jsonb_agg(to_jsonb(n)) into candidates from public.stops_near(p_lat, p_lng, 150) n;
  if candidates is not null and not coalesce(p_confirm_distinct, false) then
    return jsonb_build_object('ok', false, 'code', 'possible_duplicate',
      'message', 'There are stops within 150 m. Confirm this is a different place, or rate the existing stop.',
      'candidates', candidates);
  end if;

  insert into private.stops (name, category, address, lat, lng, creator_hash)
  values (nm, p_category, addr, p_lat, p_lng, who)
  returning id into new_id;

  insert into private.ratings (stop_id, contributor_hash, is_original, rating, cleanliness, stall_privacy,
                               key_required, food, store_rating, restroom, comment, visit_date)
  values (new_id, who, true, p_rating, coalesce(p_cleanliness, 'unknown'), coalesce(p_stall_privacy, 'unknown'),
          coalesce(p_key_required, 'unknown'), coalesce(p_food, 'unknown'), p_store_rating,
          coalesce(p_restroom, 'unspecified'), private.clean_text(p_comment), p_visit_date);

  return jsonb_build_object('ok', true, 'stop_id', new_id);
end $$;

create or replace function public.api_submit_rating(
  p_contributor text, p_stop_id uuid,
  p_rating smallint, p_cleanliness text, p_stall_privacy text, p_key_required text, p_food text,
  p_restroom text, p_comment text, p_visit_date date,
  p_store_rating smallint default null
)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  who bytea := private.decode_hash(p_contributor);
  st private.stops%rowtype;
  existing private.ratings%rowtype;
  rid uuid;
begin
  select * into st from private.stops where id = p_stop_id;
  if not found or st.status = 'hidden' then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'message', 'That stop could not be found.');
  end if;
  if st.status <> 'active' then
    return jsonb_build_object('ok', false, 'code', 'stop_closed', 'message', 'This stop is marked closed, so it is not accepting ratings.');
  end if;
  if st.creator_hash = who then
    return jsonb_build_object('ok', false, 'code', 'own_original',
      'message', 'You submitted the original rating for this stop, so you cannot also add a crowd rating to it from this browser.');
  end if;
  perform private.validate_visit_date(p_visit_date);

  select * into existing from private.ratings
   where stop_id = p_stop_id and contributor_hash = who and not is_original
   for update;
  if found and existing.status <> 'visible' then
    return jsonb_build_object('ok', false, 'code', 'rating_removed', 'message', 'Your earlier rating for this stop was removed by moderation.');
  end if;

  insert into private.ratings as r (stop_id, contributor_hash, is_original, rating, cleanliness, stall_privacy,
                                    key_required, food, store_rating, restroom, comment, visit_date)
  values (p_stop_id, who, false, p_rating, coalesce(p_cleanliness, 'unknown'), coalesce(p_stall_privacy, 'unknown'),
          coalesce(p_key_required, 'unknown'), coalesce(p_food, 'unknown'), p_store_rating,
          coalesce(p_restroom, 'unspecified'), private.clean_text(p_comment), p_visit_date)
  on conflict (stop_id, contributor_hash) where not is_original
  do update set rating = excluded.rating, cleanliness = excluded.cleanliness, stall_privacy = excluded.stall_privacy,
                key_required = excluded.key_required, food = excluded.food, store_rating = excluded.store_rating,
                restroom = excluded.restroom, comment = excluded.comment, visit_date = excluded.visit_date, updated_at = now()
          where r.status = 'visible'
  returning id into rid;

  if rid is null then
    return jsonb_build_object('ok', false, 'code', 'rating_removed', 'message', 'Your earlier rating for this stop was removed by moderation.');
  end if;
  return jsonb_build_object('ok', true, 'rating_id', rid, 'updated', existing.id is not null);
end $$;

create or replace function public.api_my_state(p_contributor text, p_stop_id uuid)
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'is_creator', exists (select 1 from private.stops s where s.id = p_stop_id and s.creator_hash = private.decode_hash(p_contributor)),
    'rating', (select jsonb_build_object('id', r.id, 'rating', r.rating, 'cleanliness', r.cleanliness,
                       'stall_privacy', r.stall_privacy, 'key_required', r.key_required, 'food', r.food,
                       'store_rating', r.store_rating,
                       'restroom', r.restroom, 'comment', r.comment, 'visit_date', r.visit_date, 'status', r.status)
               from private.ratings r
               where r.stop_id = p_stop_id and r.contributor_hash = private.decode_hash(p_contributor) and not r.is_original),
    'vote', (select case when v.status <> 'visible' then 'removed' when v.agrees then 'agree' else 'disagree' end
             from private.agreement_votes v
             where v.stop_id = p_stop_id and v.voter_hash = private.decode_hash(p_contributor))
  );
$$;

-- Grants: same narrow pattern as migration 1.
revoke all on function public.stops_in_bbox(double precision, double precision, double precision, double precision, boolean, integer) from public;
revoke all on function public.stops_in_boxes(jsonb, integer) from public;
revoke all on function public.stop_detail(uuid) from public;
revoke all on function public.api_create_stop(text, text, text, text, double precision, double precision, boolean, smallint, text, text, text, text, text, text, date, smallint) from public;
revoke all on function public.api_submit_rating(text, uuid, smallint, text, text, text, text, text, text, date, smallint) from public;
revoke all on function public.api_my_state(text, uuid) from public;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function public.stops_in_bbox(double precision, double precision, double precision, double precision, boolean, integer) from anon, authenticated, service_role;
    revoke all on function public.stops_in_boxes(jsonb, integer) from anon, authenticated, service_role;
    revoke all on function public.stop_detail(uuid) from anon, authenticated, service_role;
    revoke all on function public.api_create_stop(text, text, text, text, double precision, double precision, boolean, smallint, text, text, text, text, text, text, date, smallint) from anon, authenticated, service_role;
    revoke all on function public.api_submit_rating(text, uuid, smallint, text, text, text, text, text, text, date, smallint) from anon, authenticated, service_role;
    revoke all on function public.api_my_state(text, uuid) from anon, authenticated, service_role;

    grant execute on function public.stops_in_bbox(double precision, double precision, double precision, double precision, boolean, integer) to anon, authenticated, service_role;
    grant execute on function public.stops_in_boxes(jsonb, integer) to anon, authenticated, service_role;
    grant execute on function public.stop_detail(uuid) to anon, authenticated, service_role;
    grant execute on function public.api_create_stop(text, text, text, text, double precision, double precision, boolean, smallint, text, text, text, text, text, text, date, smallint) to service_role;
    grant execute on function public.api_submit_rating(text, uuid, smallint, text, text, text, text, text, text, date, smallint) to service_role;
    grant execute on function public.api_my_state(text, uuid) to service_role;
  end if;
end $$;

commit;
