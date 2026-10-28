-- T1 · 全栈基座与注册纵切（issue #23 / spec #22）
-- 用户档案 profiles（学号唯一，id 关联 auth.users）+ 邮箱白名单配置 + RLS 兜底 + 白名单种子。
-- 命名对照（GLOSSARY / ADR-0006）：用户档案=profiles、学号=student_id、姓名=real_name、昵称=nickname、
-- 邮箱=email、邮箱白名单配置=email_allowlist_config、单行锁=singleton、放开任意域名=allow_any_domain、
-- 邮箱白名单域名=email_allowlist_domains、域名=domain、备注=note。
-- 幂等：可重复执行，schema 与种子可从迁移文件完整重建。

-- ══════════════ 用户档案（User Profile / profiles） ══════════════
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  student_id text not null unique,
  real_name text not null,
  nickname text not null,
  email text not null,
  created_at timestamptz not null default now()
);

comment on table public.profiles is '注册纵切的用户档案：学号全局唯一（用户名职责），id 与 auth.users 一一对应';

-- RLS 兜底：启用 RLS 且不给 anon/authenticated 建任何策略 → 匿名与普通会话读不到任何用户信息；
-- 服务端走 service_role（绕过 RLS）。第一版无用户可读字段的需求。
alter table public.profiles enable row level security;

-- 注册即建档：supabase signUp 的 options.data（student_id/real_name/nickname）经 raw_user_meta_data 落档案，
-- 保证 auth 用户与档案原子创建（服务端预检学号唯一 + 表级唯一约束双保险）。
create or replace function public.handle_signup_create_profile() returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, student_id, real_name, nickname, email)
  values (
    new.id,
    new.raw_user_meta_data ->> 'student_id',
    new.raw_user_meta_data ->> 'real_name',
    new.raw_user_meta_data ->> 'nickname',
    new.email
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists handle_signup_create_profile on auth.users;
create trigger handle_signup_create_profile
  after insert on auth.users
  for each row execute function public.handle_signup_create_profile();

-- ══════════════ 邮箱白名单配置（Email Allowlist Config） ══════════════
-- 总开关（单行表）：allow_any_domain = false 时仅域名清单内可注册。
create table if not exists public.email_allowlist_config (
  singleton boolean primary key default true check (singleton),
  allow_any_domain boolean not null default false,
  updated_at timestamptz not null default now()
);

comment on table public.email_allowlist_config is '白名单总开关（单行）：放开任意域名=false 仅清单内域名可注册；第一版直接操作数据表配置';

alter table public.email_allowlist_config enable row level security;

-- 种子：开关关闭（仅白名单域名可注册）
insert into public.email_allowlist_config (singleton, allow_any_domain)
values (true, false)
on conflict (singleton) do nothing;

-- 域名清单：可含多个域名（story 5）。
create table if not exists public.email_allowlist_domains (
  domain text primary key,
  note text,
  created_at timestamptz not null default now()
);

comment on table public.email_allowlist_domains is '可配置的邮箱域名白名单清单，可含多个域名';

alter table public.email_allowlist_domains enable row level security;

-- 种子：初始仅开放 cuc.edu.cn
insert into public.email_allowlist_domains (domain, note)
values ('cuc.edu.cn', '初始白名单（spec #22）')
on conflict (domain) do nothing;
