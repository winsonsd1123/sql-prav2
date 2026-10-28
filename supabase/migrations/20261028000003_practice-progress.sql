-- T6 · 进度上云（issue #28 / spec #22）
-- 练习进度表 practice_progress：（用户 id、种子、域包）三元组主键 + 进度 JSONB + 时间戳；RLS 本人读写。
-- 命名对照（GLOSSARY / ADR-0006）：练习进度=practice_progress、用户id=user_id、种子=seed、
-- 域包=pack_id、进度=progress、触更新时间=set_updated_at。
-- 幂等：可重复执行；不做本地旧进度迁移（未正式上线，无存量数据）。

create table if not exists public.practice_progress (
  user_id uuid not null references auth.users(id) on delete cascade,
  seed bigint not null,
  pack_id text not null,
  progress jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, seed, pack_id)
);

comment on table public.practice_progress is '学生练习进度上云：尝试次数/SQL 草稿/通过状态/完成分档所需原始进度按（用户、种子、域包）三元组持久，云端为准';

comment on column public.practice_progress.progress is '进度记录 JSON（与前端 进度记录 结构一致：已通过题号/已看提示/已借助答案题号/尝试次数/草稿）';

-- updated_at 随行更新
create or replace function public.set_updated_at() returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_updated_at on public.practice_progress;
create trigger set_updated_at
  before update on public.practice_progress
  for each row execute function public.set_updated_at();

-- RLS：仅本人可读写自己的进度（浏览器端 anon 会话直连，判 uid() = user_id）
alter table public.practice_progress enable row level security;

drop policy if exists owner_select_progress on public.practice_progress;
create policy owner_select_progress on public.practice_progress
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists owner_insert_progress on public.practice_progress;
create policy owner_insert_progress on public.practice_progress
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists owner_update_progress on public.practice_progress;
create policy owner_update_progress on public.practice_progress
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- upsert（insert ... on conflict do update）需 insert + update 双策略，已齐备。
