-- T6 · 进度上云（issue #28 / spec #22）
-- 练习进度表：（用户 id、种子、域包）三元组主键 + 进度 JSONB + 时间戳；RLS 本人读写。
-- 幂等：可重复执行；不做本地旧进度迁移（未正式上线，无存量数据）。

create table if not exists public.练习进度 (
  用户id uuid not null references auth.users(id) on delete cascade,
  种子 bigint not null,
  域包 text not null,
  进度 jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (用户id, 种子, 域包)
);

comment on table public.练习进度 is '学生练习进度上云：尝试次数/SQL 草稿/通过状态/完成分档所需原始进度按（用户、种子、域包）三元组持久，云端为准';

comment on column public.练习进度.进度 is '进度记录 JSON（与前端 进度记录 结构一致：已通过题号/已看提示/已借助答案题号/尝试次数/草稿）';

-- updated_at 随行更新
create or replace function public.触更新时间() returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists 触更新时间 on public.练习进度;
create trigger 触更新时间
  before update on public.练习进度
  for each row execute function public.触更新时间();

-- RLS：仅本人可读写自己的进度（浏览器端 anon 会话直连，判 uid() = 用户id）
alter table public.练习进度 enable row level security;

drop policy if exists 本人读进度 on public.练习进度;
create policy 本人读进度 on public.练习进度
  for select to authenticated
  using (用户id = auth.uid());

drop policy if exists 本人写进度 on public.练习进度;
create policy 本人写进度 on public.练习进度
  for insert to authenticated
  with check (用户id = auth.uid());

drop policy if exists 本人改进度 on public.练习进度;
create policy 本人改进度 on public.练习进度
  for update to authenticated
  using (用户id = auth.uid())
  with check (用户id = auth.uid());

-- upsert（insert ... on conflict do update）需 insert + update 双策略，已齐备。
