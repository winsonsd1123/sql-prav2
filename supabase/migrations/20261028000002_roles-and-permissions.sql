-- T5 · 权限点判定与参考答案豁免（issue #27 / spec #22，ADR-0005）
-- RBAC 四表（角色 roles、权限点 permissions、角色-权限 role_permissions、用户-角色 user_roles，均多对多）
-- + RLS 兜底 + 三角色种子 + 存量用户回填学生角色 + 注册建档触发器扩展为自动挂学生角色。
-- 命名对照（GLOSSARY / ADR-0006）：角色=roles、权限点=permissions、角色-权限=role_permissions、
-- 用户-角色=user_roles、名称=name、备注=note、用户=user_id、用户档案=profiles。
-- 幂等：可重复执行，schema 与种子可从迁移文件完整重建。
-- 一切行为判定只认权限点不认角色；本票仅启用「随时查看参考答案」（挂助教、教师）。

-- ══════════════ 角色（Role / roles） ══════════════
create table if not exists public.roles (
  name text primary key,
  note text,
  created_at timestamptz not null default now()
);

comment on table public.roles is '职责标签（学生/助教/教师……）：自身不含行为规则，仅通过挂载权限点获得能力（ADR-0005）';

-- ══════════════ 权限点（Permission / permissions） ══════════════
create table if not exists public.permissions (
  name text primary key,
  note text,
  created_at timestamptz not null default now()
);

comment on table public.permissions is '系统能力的最小命名单元；一切行为判定只认权限点，不认角色';

-- ══════════════ 角色-权限（多对多 / role_permissions） ══════════════
create table if not exists public.role_permissions (
  role text not null references public.roles(name) on delete cascade,
  permission text not null references public.permissions(name) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (role, permission)
);

comment on table public.role_permissions is '角色与权限点的多对多挂载：调整角色能力只是数据变更';

-- ══════════════ 用户-角色（多对多 / user_roles） ══════════════
create table if not exists public.user_roles (
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null references public.roles(name) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, role)
);

comment on table public.user_roles is '用户与角色的多对多持有：一人可同时为学生+助教，能力为权限点并集';

-- ══════════════ RLS ══════════════
-- 兜底防线（spec #22 安全边界）：四表启用 RLS。
-- 角色/权限点/角色-权限是只读参照数据：仅登录用户可读（anon 读不到任何东西）；
-- 用户-角色含用户信息：仅本人可读自己的持有记录。写操作一律走 service_role（管理员直接操作数据表）。
alter table public.roles enable row level security;
alter table public.permissions enable row level security;
alter table public.role_permissions enable row level security;
alter table public.user_roles enable row level security;

drop policy if exists authenticated_read_roles on public.roles;
create policy authenticated_read_roles on public.roles
  for select to authenticated using (true);

drop policy if exists authenticated_read_permissions on public.permissions;
create policy authenticated_read_permissions on public.permissions
  for select to authenticated using (true);

drop policy if exists authenticated_read_role_permissions on public.role_permissions;
create policy authenticated_read_role_permissions on public.role_permissions
  for select to authenticated using (true);

drop policy if exists self_read_user_roles on public.user_roles;
create policy self_read_user_roles on public.user_roles
  for select to authenticated using (user_id = auth.uid());

-- ══════════════ 种子 ══════════════
insert into public.roles (name, note) values
  ('学生', '默认角色：按摩擦力规则解锁提示与参考答案'),
  ('助教', '答疑场景：挂「随时查看参考答案」，往往同时持有学生角色'),
  ('教师', '备课与答疑：挂「随时查看参考答案」')
on conflict (name) do nothing;

insert into public.permissions (name, note) values
  ('随时查看参考答案', '第一版唯一启用的权限点：免摩擦力门槛直接查看，且不构成「借助答案」（ADR-0003 修订 v3）'),
  ('编辑题库', '占位：待题库编辑功能实现时启用'),
  ('安排练习', '占位：待个性化安排测试功能实现时启用'),
  ('查看学情', '占位：待学情采集统计功能实现时启用')
on conflict (name) do nothing;

-- 「随时查看参考答案」仅挂助教、教师；占位权限点不挂任何角色（预定义零成本，YAGNI）
insert into public.role_permissions (role, permission)
values ('助教', '随时查看参考答案'), ('教师', '随时查看参考答案')
on conflict (role, permission) do nothing;

-- ══════════════ 存量回填：已有档案的用户全部补挂学生角色 ══════════════
-- 回填前后行为无缝：学生角色无权限点，回填等价于摩擦力规则不变。
insert into public.user_roles (user_id, role)
select id, '学生' from public.profiles
on conflict (user_id, role) do nothing;

-- ══════════════ 注册自动挂学生角色（建档触发器扩展） ══════════════
-- 复用 T1 的 handle_signup_create_profile 触发器（security definer，绕过 RLS）：
-- 建档后同步插入 学生 角色持有（on conflict 幂等；角色由上方种子保证存在）。
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

  insert into public.user_roles (user_id, role)
  values (new.id, '学生')
  on conflict (user_id, role) do nothing;
  return new;
end;
$$;

-- 触发器本身已存在（T1 迁移创建），仅需函数重定义生效；保持声明幂等以防独立执行。
drop trigger if exists handle_signup_create_profile on auth.users;
create trigger handle_signup_create_profile
  after insert on auth.users
  for each row execute function public.handle_signup_create_profile();
