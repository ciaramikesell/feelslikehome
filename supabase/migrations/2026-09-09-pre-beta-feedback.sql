-- Pre-beta feedback: one-way, caller-bound feedback records.
-- Apply manually before enabling the application flag in production.
begin;

create table public.beta_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  search_id uuid,
  home_id uuid,
  route text not null,
  search_intent text,
  feedback_type text,
  message text not null,
  is_blocking boolean not null default false,
  viewport_width integer,
  viewport_height integer,
  device_class text,
  user_agent text,
  app_version text,
  screenshot_path text,
  created_at timestamptz not null default now(),
  constraint beta_feedback_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade,
  constraint beta_feedback_route_check check (char_length(route) between 1 and 2048),
  constraint beta_feedback_search_intent_check check (search_intent is null or search_intent = any (array['purchase','rental','investment']::text[])),
  constraint beta_feedback_type_check check (feedback_type is null or feedback_type = any (array['broken','confusing','idea']::text[])),
  constraint beta_feedback_message_check check (char_length(btrim(message)) between 1 and 2000),
  constraint beta_feedback_viewport_width_check check (viewport_width is null or viewport_width between 1 and 100000),
  constraint beta_feedback_viewport_height_check check (viewport_height is null or viewport_height between 1 and 100000),
  constraint beta_feedback_device_class_check check (device_class is null or device_class = any (array['mobile','tablet','desktop']::text[])),
  constraint beta_feedback_user_agent_check check (user_agent is null or char_length(user_agent) <= 1024),
  constraint beta_feedback_app_version_check check (app_version is null or char_length(app_version) <= 255),
  constraint beta_feedback_screenshot_path_check check (screenshot_path is null or char_length(screenshot_path) <= 1024)
);

alter table public.beta_feedback enable row level security;

revoke all on table public.beta_feedback from public, anon, authenticated;
grant insert (
  user_id, search_id, home_id, route, search_intent, feedback_type, message,
  is_blocking, viewport_width, viewport_height, device_class, user_agent,
  app_version, screenshot_path
) on public.beta_feedback to authenticated;

create policy "beta_feedback_insert_own" on public.beta_feedback
  for insert to authenticated
  with check (auth.uid() is not null and auth.uid() = user_id);

notify pgrst, 'reload schema';
commit;
