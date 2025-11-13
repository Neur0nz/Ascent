create extension if not exists pg_cron;

create or replace function public.cleanup_stale_web_push_subscriptions()
returns void
language plpgsql
as $$
declare
  deleted_count bigint;
  cutoff interval := interval '30 days';
begin
  delete from public.web_push_subscriptions
  where (
    last_used_at is not null and last_used_at < now() - cutoff
  )
    or (
      last_used_at is null and updated_at < now() - cutoff
    );

  get diagnostics deleted_count = row_count;

  raise notice 'cleanup_stale_web_push_subscriptions removed % rows', deleted_count;
end;
$$;

do $$
declare
  existing_job_id integer;
begin
  select jobid into existing_job_id from cron.job where jobname = 'cleanup_stale_web_push_subscriptions';
  if existing_job_id is not null then
    perform cron.unschedule(existing_job_id);
  end if;

  perform cron.schedule(
    'cleanup_stale_web_push_subscriptions',
    '0 6 * * *',
    'select public.cleanup_stale_web_push_subscriptions();'
  );
end;
$$;
