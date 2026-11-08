-- Playotic Plops: schema, constraints, RLS, read API and service-only write API.
--
-- Design:
--   * All tables live in the `private` schema, which is NOT exposed through the Data API.
--     RLS is enabled on every table with no policies (deny-all) as defence in depth.
--   * Visitors read through a few narrowly scoped SECURITY DEFINER functions in `public`
--     that return only public columns. No contributor hashes, report text or rate-limit
--     buckets ever leave the database through these functions.
--   * Writes are only possible through `public.api_*` functions, executable solely by
--     `service_role` (i.e. the `plops` Edge Function holding the secret key). The Edge
--     Function verifies the challenge, hashes the browser token and applies rate limits.
--   * Aggregates (crowd average, counts, agreement) are always computed at read time from
--     visible records, so hiding or invalidating a record removes it from every aggregate
--     immediately. Callers can never supply counts.

create schema if not exists private;
revoke all on schema private from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on schema private from anon, authenticated, service_role';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table private.stops (
  id               uuid primary key default gen_random_uuid(),
  name             text not null check (char_length(btrim(name)) between 2 and 80 and name !~ '[[:cntrl:]]'),
  category         text not null check (category in ('gas_station', 'travel_center', 'rest_area')),
  address          text not null check (char_length(btrim(address)) between 3 and 200 and address !~ '[[:cntrl:]]'),
  lat              double precision not null check (lat between -90 and 90),
  lng              double precision not null check (lng between -180 and 180),
  status           text not null default 'active' check (status in ('active', 'closed', 'hidden')),
  creator_hash     bytea not null check (octet_length(creator_hash) = 32),
  moderation_note  text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index stops_lat_lng_idx on private.stops (lat, lng) where status <> 'hidden';

create table private.ratings (
  id               uuid primary key default gen_random_uuid(),
  stop_id          uuid not null references private.stops (id) on delete cascade,
  contributor_hash bytea not null check (octet_length(contributor_hash) = 32),
  is_original      boolean not null default false,
  rating           smallint not null check (rating between 1 and 5),
  cleanliness      text not null default 'unknown' check (cleanliness in ('dirty', 'okay', 'very_clean', 'unknown')),
  stall_privacy    text not null default 'unknown' check (stall_privacy in ('gaps', 'full_doors', 'single_user', 'unknown')),
  key_required     text not null default 'unknown' check (key_required in ('yes', 'no', 'unknown')),
  food             text not null default 'unknown' check (food in ('none', 'snacks', 'hot_food', 'unknown')),
  restroom         text not null default 'unspecified' check (restroom in ('mens', 'womens', 'all_gender', 'unspecified')),
  comment          text check (comment is null or (char_length(comment) between 1 and 280 and comment !~ '[[:cntrl:]]')),
  visit_date       date not null check (visit_date >= date '2000-01-01'),
  status           text not null default 'visible' check (status in ('visible', 'hidden')),
  moderation_note  text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
-- Exactly one original submission per stop.
create unique index ratings_one_original_idx on private.ratings (stop_id) where is_original;
-- One current crowd rating per browser identity per stop (edits update this row).
create unique index ratings_one_crowd_per_identity_idx on private.ratings (stop_id, contributor_hash) where not is_original;
create index ratings_stop_idx on private.ratings (stop_id, status, visit_date desc);

create table private.agreement_votes (
  stop_id     uuid not null references private.stops (id) on delete cascade,
  voter_hash  bytea not null check (octet_length(voter_hash) = 32),
  agrees      boolean not null,
  status      text not null default 'visible' check (status in ('visible', 'hidden')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (stop_id, voter_hash)
);

create table private.reports (
  id               uuid primary key default gen_random_uuid(),
  stop_id          uuid not null references private.stops (id) on delete cascade,
  rating_id        uuid references private.ratings (id) on delete set null,
  reason           text not null check (reason in ('fake_or_duplicate', 'closed_or_not_public', 'wrong_location', 'spam_or_abuse', 'personal_info', 'other')),
  details          text check (details is null or (char_length(details) between 1 and 500 and details !~ '[[:cntrl:]]')),
  reporter_hash    bytea not null check (octet_length(reporter_hash) = 32),
  status           text not null default 'open' check (status in ('open', 'resolved', 'dismissed')),
  resolution_note  text,
  created_at       timestamptz not null default now(),
  resolved_at      timestamptz
);
create unique index reports_one_open_per_reporter_idx on private.reports
  (stop_id, coalesce(rating_id, '00000000-0000-0000-0000-000000000000'::uuid), reporter_hash, reason)
  where status = 'open';
create index reports_status_idx on private.reports (status, created_at);

-- Transient abuse-prevention buckets: keyed HMACs only (never raw IPs or raw tokens).
-- Rows older than 2 days are pruned automatically.
create table private.rate_events (
  id          bigint generated always as identity primary key,
  bucket      bytea not null check (octet_length(bucket) = 32),
  action      text not null,
  created_at  timestamptz not null default now()
);
create index rate_events_bucket_idx on private.rate_events (bucket, action, created_at);
create index rate_events_created_idx on private.rate_events (created_at);

alter table private.stops enable row level security;
alter table private.ratings enable row level security;
alter table private.agreement_votes enable row level security;
alter table private.reports enable row level security;
alter table private.rate_events enable row level security;

revoke all on all tables in schema private from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on all tables in schema private from anon, authenticated, service_role';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Helpers (private)
-- ---------------------------------------------------------------------------

create or replace function private.distance_m(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision)
returns double precision
language sql immutable parallel safe
set search_path = ''
as $$
  select 2 * 6371008.8 * asin(least(1, sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)
  )));
$$;

create or replace function private.normalize_name(p text)
returns text language sql immutable parallel safe set search_path = ''
as $$ select regexp_replace(lower(coalesce(p, '')), '[^a-z0-9]+', '', 'g'); $$;

create or replace function private.decode_hash(p text)
returns bytea language plpgsql immutable set search_path = ''
as $$
begin
  if p is null or p !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid identity hash' using errcode = '22023';
  end if;
  return decode(p, 'hex');
end $$;

create or replace function private.clean_text(p text)
returns text language sql immutable set search_path = ''
as $$ select nullif(btrim(regexp_replace(coalesce(p, ''), '[[:cntrl:][:space:]]+', ' ', 'g')), ''); $$;

-- Public summary of every non-hidden stop, with aggregates from visible records only.
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
  lf.food,          lf.visit_date as food_visit_date
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
where s.status <> 'hidden';

revoke all on private.stop_public from public;

-- ---------------------------------------------------------------------------
-- Public read API (anon may execute)
-- ---------------------------------------------------------------------------

create or replace function public.stops_in_bbox(
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
  key_required text, key_required_visit_date date, food text, food_visit_date date
)
language sql stable security definer
set search_path = ''
as $$
  select sp.id, sp.name, sp.category, sp.address, sp.lat, sp.lng, sp.status, sp.created_at,
         sp.original_rating, sp.original_visit_date, sp.agree_count, sp.disagree_count,
         sp.crowd_count, sp.crowd_avg, sp.last_visit_date, sp.last_rated_at,
         sp.cleanliness, sp.cleanliness_visit_date, sp.stall_privacy, sp.stall_privacy_visit_date,
         sp.key_required, sp.key_required_visit_date, sp.food, sp.food_visit_date
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

-- Corridor search: up to 40 boxes [[south, west, north, east], ...] along a route.
create or replace function public.stops_in_boxes(p_boxes jsonb, p_limit integer default 300)
returns table (
  id uuid, name text, category text, address text, lat double precision, lng double precision,
  status text, created_at timestamptz,
  original_rating smallint, original_visit_date date, agree_count int, disagree_count int,
  crowd_count int, crowd_avg numeric, last_visit_date date, last_rated_at timestamptz,
  cleanliness text, cleanliness_visit_date date, stall_privacy text, stall_privacy_visit_date date,
  key_required text, key_required_visit_date date, food text, food_visit_date date
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
         sp.key_required, sp.key_required_visit_date, sp.food, sp.food_visit_date
  from private.stop_public sp
  where sp.status = 'active'
    and exists (select 1 from valid v where sp.lat between v.s and v.n and sp.lng between v.w and v.e)
  limit greatest(1, least(coalesce(p_limit, 300), 500));
end $$;

-- Nearby stops for duplicate warnings when adding a stop.
create or replace function public.stops_near(p_lat double precision, p_lng double precision, p_radius_m integer default 300)
returns table (id uuid, name text, category text, address text, lat double precision, lng double precision, status text, distance_m double precision)
language sql stable security definer
set search_path = ''
as $$
  with r as (select greatest(10, least(coalesce(p_radius_m, 300), 2000))::double precision as m)
  select s.id, s.name, s.category, s.address, s.lat, s.lng, s.status,
         private.distance_m(p_lat, p_lng, s.lat, s.lng) as distance_m
  from private.stops s, r
  where s.status <> 'hidden'
    and p_lat between -90 and 90 and p_lng between -180 and 180
    and s.lat between p_lat - r.m / 111000.0 and p_lat + r.m / 111000.0
    and s.lng between p_lng - r.m / (111000.0 * greatest(cos(radians(p_lat)), 0.01))
                  and p_lng + r.m / (111000.0 * greatest(cos(radians(p_lat)), 0.01))
    and private.distance_m(p_lat, p_lng, s.lat, s.lng) <= r.m
  order by distance_m
  limit 20;
$$;

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
                 r.restroom, r.comment, r.visit_date, r.created_at, r.updated_at
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

-- ---------------------------------------------------------------------------
-- Service-only write API (called by the `plops` Edge Function)
-- ---------------------------------------------------------------------------

-- Sliding-window limiter. Returns true when the event is allowed (and records it).
create or replace function public.api_rate_limit(p_bucket text, p_action text, p_max integer, p_window_seconds integer)
returns boolean
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  b bytea := private.decode_hash(p_bucket);
  n integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_bucket || ':' || p_action, 0));
  -- opportunistic pruning keeps transient identifiers short-lived
  delete from private.rate_events where created_at < now() - interval '2 days';
  select count(*) into n from private.rate_events
   where bucket = b and action = p_action and created_at > now() - make_interval(secs => p_window_seconds);
  if n >= p_max then
    return false;
  end if;
  insert into private.rate_events (bucket, action) values (b, p_action);
  return true;
end $$;

create or replace function private.validate_visit_date(p date)
returns void language plpgsql stable set search_path = ''
as $$
begin
  if p is null or p > current_date + 1 or p < current_date - 730 then
    raise exception 'visit date must be within the last two years and not in the future' using errcode = '22023';
  end if;
end $$;

create or replace function public.api_create_stop(
  p_contributor text,
  p_name text, p_category text, p_address text, p_lat double precision, p_lng double precision,
  p_confirm_distinct boolean,
  p_rating smallint, p_cleanliness text, p_stall_privacy text, p_key_required text, p_food text,
  p_restroom text, p_comment text, p_visit_date date
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
                               key_required, food, restroom, comment, visit_date)
  values (new_id, who, true, p_rating, coalesce(p_cleanliness, 'unknown'), coalesce(p_stall_privacy, 'unknown'),
          coalesce(p_key_required, 'unknown'), coalesce(p_food, 'unknown'), coalesce(p_restroom, 'unspecified'),
          private.clean_text(p_comment), p_visit_date);

  return jsonb_build_object('ok', true, 'stop_id', new_id);
end $$;

create or replace function public.api_submit_rating(
  p_contributor text, p_stop_id uuid,
  p_rating smallint, p_cleanliness text, p_stall_privacy text, p_key_required text, p_food text,
  p_restroom text, p_comment text, p_visit_date date
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
                                    key_required, food, restroom, comment, visit_date)
  values (p_stop_id, who, false, p_rating, coalesce(p_cleanliness, 'unknown'), coalesce(p_stall_privacy, 'unknown'),
          coalesce(p_key_required, 'unknown'), coalesce(p_food, 'unknown'), coalesce(p_restroom, 'unspecified'),
          private.clean_text(p_comment), p_visit_date)
  on conflict (stop_id, contributor_hash) where not is_original
  do update set rating = excluded.rating, cleanliness = excluded.cleanliness, stall_privacy = excluded.stall_privacy,
                key_required = excluded.key_required, food = excluded.food, restroom = excluded.restroom,
                comment = excluded.comment, visit_date = excluded.visit_date, updated_at = now()
          where r.status = 'visible'
  returning id into rid;

  if rid is null then
    return jsonb_build_object('ok', false, 'code', 'rating_removed', 'message', 'Your earlier rating for this stop was removed by moderation.');
  end if;
  return jsonb_build_object('ok', true, 'rating_id', rid, 'updated', existing.id is not null);
end $$;

create or replace function public.api_set_agreement(p_voter text, p_stop_id uuid, p_vote text)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  who bytea := private.decode_hash(p_voter);
  st private.stops%rowtype;
  cur private.agreement_votes%rowtype;
begin
  if p_vote not in ('agree', 'disagree', 'none') then
    raise exception 'vote must be agree, disagree or none' using errcode = '22023';
  end if;
  select * into st from private.stops where id = p_stop_id;
  if not found or st.status = 'hidden' then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'message', 'That stop could not be found.');
  end if;
  if st.status <> 'active' then
    return jsonb_build_object('ok', false, 'code', 'stop_closed', 'message', 'This stop is marked closed.');
  end if;
  if not exists (select 1 from private.ratings where stop_id = p_stop_id and is_original and status = 'visible') then
    return jsonb_build_object('ok', false, 'code', 'no_original', 'message', 'There is no original rating to vote on.');
  end if;
  if st.creator_hash = who then
    return jsonb_build_object('ok', false, 'code', 'own_original', 'message', 'You cannot vote on your own original rating.');
  end if;

  select * into cur from private.agreement_votes where stop_id = p_stop_id and voter_hash = who for update;
  if found and cur.status <> 'visible' then
    return jsonb_build_object('ok', false, 'code', 'vote_removed', 'message', 'Your earlier vote on this stop was removed by moderation.');
  end if;

  if p_vote = 'none' then
    delete from private.agreement_votes where stop_id = p_stop_id and voter_hash = who and status = 'visible';
  else
    insert into private.agreement_votes as v (stop_id, voter_hash, agrees)
    values (p_stop_id, who, p_vote = 'agree')
    on conflict (stop_id, voter_hash)
    do update set agrees = excluded.agrees, updated_at = now() where v.status = 'visible';
  end if;
  return jsonb_build_object('ok', true, 'vote', p_vote);
end $$;

create or replace function public.api_create_report(p_reporter text, p_stop_id uuid, p_rating_id uuid, p_reason text, p_details text)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  who bytea := private.decode_hash(p_reporter);
begin
  if not exists (select 1 from private.stops where id = p_stop_id and status <> 'hidden') then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'message', 'That stop could not be found.');
  end if;
  if p_rating_id is not null and not exists (select 1 from private.ratings where id = p_rating_id and stop_id = p_stop_id) then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'message', 'That rating could not be found.');
  end if;
  insert into private.reports (stop_id, rating_id, reason, details, reporter_hash)
  values (p_stop_id, p_rating_id, p_reason, private.clean_text(p_details), who)
  on conflict do nothing;
  return jsonb_build_object('ok', true);
end $$;

-- What this browser identity has contributed to one stop (so the UI can offer "edit").
create or replace function public.api_my_state(p_contributor text, p_stop_id uuid)
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'is_creator', exists (select 1 from private.stops s where s.id = p_stop_id and s.creator_hash = private.decode_hash(p_contributor)),
    'rating', (select jsonb_build_object('id', r.id, 'rating', r.rating, 'cleanliness', r.cleanliness,
                       'stall_privacy', r.stall_privacy, 'key_required', r.key_required, 'food', r.food,
                       'restroom', r.restroom, 'comment', r.comment, 'visit_date', r.visit_date, 'status', r.status)
               from private.ratings r
               where r.stop_id = p_stop_id and r.contributor_hash = private.decode_hash(p_contributor) and not r.is_original),
    'vote', (select case when v.status <> 'visible' then 'removed' when v.agrees then 'agree' else 'disagree' end
             from private.agreement_votes v
             where v.stop_id = p_stop_id and v.voter_hash = private.decode_hash(p_contributor))
  );
$$;

-- ---------------------------------------------------------------------------
-- Owner moderation helpers. Run these in the Supabase SQL Editor (as postgres).
-- They are in `private`, are not exposed, and are not executable by API roles.
-- ---------------------------------------------------------------------------

create or replace view private.moderation_queue as
select rp.id as report_id, rp.created_at, rp.reason, rp.details, rp.status,
       s.id as stop_id, s.name as stop_name, s.status as stop_status, s.address,
       rp.rating_id, r.rating, r.is_original, r.comment, r.status as rating_status,
       (select count(*) from private.reports x where x.stop_id = rp.stop_id and x.status = 'open') as open_reports_for_stop
from private.reports rp
join private.stops s on s.id = rp.stop_id
left join private.ratings r on r.id = rp.rating_id
where rp.status = 'open'
order by rp.created_at;

create or replace function private.mod_hide_stop(p_stop_id uuid, p_note text default null)
returns void language sql security definer set search_path = '' as $$
  update private.stops set status = 'hidden', moderation_note = p_note, updated_at = now() where id = p_stop_id;
$$;
create or replace function private.mod_mark_closed(p_stop_id uuid, p_note text default null)
returns void language sql security definer set search_path = '' as $$
  update private.stops set status = 'closed', moderation_note = p_note, updated_at = now() where id = p_stop_id;
$$;
create or replace function private.mod_reopen_stop(p_stop_id uuid, p_note text default null)
returns void language sql security definer set search_path = '' as $$
  update private.stops set status = 'active', moderation_note = p_note, updated_at = now() where id = p_stop_id;
$$;
create or replace function private.mod_move_stop(p_stop_id uuid, p_lat double precision, p_lng double precision, p_note text default null)
returns void language sql security definer set search_path = '' as $$
  update private.stops set lat = p_lat, lng = p_lng, moderation_note = p_note, updated_at = now() where id = p_stop_id;
$$;
create or replace function private.mod_hide_rating(p_rating_id uuid, p_note text default null)
returns void language sql security definer set search_path = '' as $$
  update private.ratings set status = 'hidden', moderation_note = p_note, updated_at = now() where id = p_rating_id;
$$;
create or replace function private.mod_restore_rating(p_rating_id uuid)
returns void language sql security definer set search_path = '' as $$
  update private.ratings set status = 'visible', moderation_note = null, updated_at = now() where id = p_rating_id;
$$;
-- Hide every contribution from one browser identity (e.g. a spam burst), identified via a rating it wrote.
create or replace function private.mod_hide_identity_of_rating(p_rating_id uuid, p_note text default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare h bytea; n integer := 0; m integer;
begin
  select contributor_hash into h from private.ratings where id = p_rating_id;
  if h is null then return 0; end if;
  update private.ratings set status = 'hidden', moderation_note = p_note, updated_at = now() where contributor_hash = h and status = 'visible';
  get diagnostics m = row_count; n := n + m;
  update private.agreement_votes set status = 'hidden', updated_at = now() where voter_hash = h and status = 'visible';
  get diagnostics m = row_count; n := n + m;
  update private.stops set status = 'hidden', moderation_note = p_note, updated_at = now() where creator_hash = h and status <> 'hidden';
  get diagnostics m = row_count; n := n + m;
  return n;
end $$;
create or replace function private.mod_resolve_report(p_report_id uuid, p_status text default 'resolved', p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_status not in ('resolved', 'dismissed') then raise exception 'status must be resolved or dismissed'; end if;
  update private.reports set status = p_status, resolution_note = p_note, resolved_at = now() where id = p_report_id;
end $$;

-- ---------------------------------------------------------------------------
-- Grants: explicit and narrow.
-- ---------------------------------------------------------------------------

do $$
declare f record;
begin
  -- Strip default PUBLIC execute from every function this migration created.
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where (n.nspname = 'private')
       or (n.nspname = 'public' and p.proname in ('stops_in_bbox', 'stops_in_boxes', 'stops_near', 'stop_detail',
            'api_rate_limit', 'api_create_stop', 'api_submit_rating', 'api_set_agreement', 'api_create_report', 'api_my_state'))
  loop
    execute format('revoke all on function %s from public', f.sig);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on function %s from anon, authenticated, service_role', f.sig);
    end if;
  end loop;

  if exists (select 1 from pg_roles where rolname = 'anon') then
    grant execute on function public.stops_in_bbox(double precision, double precision, double precision, double precision, boolean, integer) to anon, authenticated, service_role;
    grant execute on function public.stops_in_boxes(jsonb, integer) to anon, authenticated, service_role;
    grant execute on function public.stops_near(double precision, double precision, integer) to anon, authenticated, service_role;
    grant execute on function public.stop_detail(uuid) to anon, authenticated, service_role;

    grant execute on function public.api_rate_limit(text, text, integer, integer) to service_role;
    grant execute on function public.api_create_stop(text, text, text, text, double precision, double precision, boolean, smallint, text, text, text, text, text, text, date) to service_role;
    grant execute on function public.api_submit_rating(text, uuid, smallint, text, text, text, text, text, text, date) to service_role;
    grant execute on function public.api_set_agreement(text, uuid, text) to service_role;
    grant execute on function public.api_create_report(text, uuid, uuid, text, text) to service_role;
    grant execute on function public.api_my_state(text, uuid) to service_role;
  end if;
end $$;
