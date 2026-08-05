-- Scheduled publish for school comms (notices, news, gallery)

alter table public.school_comms_desk_notices
  add column if not exists scheduled_publish_at timestamptz;

alter table public.school_comms_desk_news
  add column if not exists scheduled_publish_at timestamptz;

alter table public.school_comms_desk_albums
  add column if not exists scheduled_publish_at timestamptz;

create index if not exists school_comms_desk_notices_scheduled_idx
  on public.school_comms_desk_notices (tenant_id, status, scheduled_publish_at)
  where status = 'scheduled';

create index if not exists school_comms_desk_news_scheduled_idx
  on public.school_comms_desk_news (tenant_id, status, scheduled_publish_at)
  where status = 'scheduled';

create index if not exists school_comms_desk_albums_scheduled_idx
  on public.school_comms_desk_albums (tenant_id, status, scheduled_publish_at)
  where status = 'scheduled';
