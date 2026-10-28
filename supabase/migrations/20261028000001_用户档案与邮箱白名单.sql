-- T1 · 全栈基座与注册纵切（issue #23 / spec #22）
-- 用户档案（学号唯一，id 关联 auth.users）+ 邮箱白名单配置 + RLS 兜底 + 白名单种子。
-- 幂等：可重复执行，schema 与种子可从迁移文件完整重建。

-- ══════════════ 用户档案 ══════════════
create table if not exists public.用户档案 (
  id uuid primary key references auth.users(id) on delete cascade,
  学号 text not null unique,
  姓名 text not null,
  昵称 text not null,
  邮箱 text not null,
  created_at timestamptz not null default now()
);

comment on table public.用户档案 is '注册纵切的用户档案：学号全局唯一（用户名职责），id 与 auth.users 一一对应';

-- RLS 兜底：启用 RLS 且不给 anon/authenticated 建任何策略 → 匿名与普通会话读不到任何用户信息；
-- 服务端走 service_role（绕过 RLS）。第一版无用户可读字段的需求。
alter table public.用户档案 enable row level security;

-- 注册即建档：supabase signUp 的 options.data（学号/姓名/昵称）经 raw_user_meta_data 落档案，
-- 保证 auth 用户与档案原子创建（服务端预检学号唯一 + 表级唯一约束双保险）。
create or replace function public.注册时建立档案() returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.用户档案 (id, 学号, 姓名, 昵称, 邮箱)
  values (
    new.id,
    new.raw_user_meta_data ->> '学号',
    new.raw_user_meta_data ->> '姓名',
    new.raw_user_meta_data ->> '昵称',
    new.email
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists 注册时建立档案 on auth.users;
create trigger 注册时建立档案
  after insert on auth.users
  for each row execute function public.注册时建立档案();

-- ══════════════ 邮箱白名单配置 ══════════════
-- 总开关（单行表）：放开任意域名 = false 时仅域名清单内可注册。
create table if not exists public.邮箱白名单配置 (
  单行锁 boolean primary key default true check (单行锁),
  放开任意域名 boolean not null default false,
  updated_at timestamptz not null default now()
);

comment on table public.邮箱白名单配置 is '白名单总开关（单行）：放开任意域名=false 仅清单内域名可注册；第一版直接操作数据表配置';

alter table public.邮箱白名单配置 enable row level security;

-- 种子：开关关闭（仅白名单域名可注册）
insert into public.邮箱白名单配置 (单行锁, 放开任意域名)
values (true, false)
on conflict (单行锁) do nothing;

-- 域名清单：可含多个域名（story 5）。
create table if not exists public.邮箱白名单域名 (
  域名 text primary key,
  备注 text,
  created_at timestamptz not null default now()
);

comment on table public.邮箱白名单域名 is '可配置的邮箱域名白名单清单，可含多个域名';

alter table public.邮箱白名单域名 enable row level security;

-- 种子：初始仅开放 cuc.edu.cn
insert into public.邮箱白名单域名 (域名, 备注)
values ('cuc.edu.cn', '初始白名单（spec #22）')
on conflict (域名) do nothing;
