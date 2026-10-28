-- T5 · 权限点判定与参考答案豁免（issue #27 / spec #22，ADR-0005）
-- RBAC 四表（角色、权限点、角色-权限、用户-角色，均多对多）+ RLS 兜底 + 三角色种子
-- + 存量用户回填学生角色 + 注册建档触发器扩展为自动挂学生角色。
-- 幂等：可重复执行，schema 与种子可从迁移文件完整重建。
-- 一切行为判定只认权限点不认角色；本票仅启用「随时查看参考答案」（挂助教、教师）。

-- ══════════════ 角色 ══════════════
create table if not exists public.角色 (
  名称 text primary key,
  备注 text,
  created_at timestamptz not null default now()
);

comment on table public.角色 is '职责标签（学生/助教/教师……）：自身不含行为规则，仅通过挂载权限点获得能力（ADR-0005）';

-- ══════════════ 权限点 ══════════════
create table if not exists public.权限点 (
  名称 text primary key,
  备注 text,
  created_at timestamptz not null default now()
);

comment on table public.权限点 is '系统能力的最小命名单元；一切行为判定只认权限点，不认角色';

-- ══════════════ 角色-权限（多对多） ══════════════
create table if not exists public.角色-权限 (
  角色 text not null references public.角色(名称) on delete cascade,
  权限点 text not null references public.权限点(名称) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (角色, 权限点)
);

comment on table public.角色-权限 is '角色与权限点的多对多挂载：调整角色能力只是数据变更';

-- ══════════════ 用户-角色（多对多） ══════════════
create table if not exists public.用户-角色 (
  用户 uuid not null references public.用户档案(id) on delete cascade,
  角色 text not null references public.角色(名称) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (用户, 角色)
);

comment on table public.用户-角色 is '用户与角色的多对多持有：一人可同时为学生+助教，能力为权限点并集';

-- ══════════════ RLS ══════════════
-- 兜底防线（spec #22 安全边界）：四表启用 RLS。
-- 角色/权限点/角色-权限是只读参照数据：仅登录用户可读（anon 读不到任何东西）；
-- 用户-角色含用户信息：仅本人可读自己的持有记录。写操作一律走 service_role（管理员直接操作数据表）。
alter table public.角色 enable row level security;
alter table public.权限点 enable row level security;
alter table public.角色-权限 enable row level security;
alter table public.用户-角色 enable row level security;

drop policy if exists 登录可读角色 on public.角色;
create policy 登录可读角色 on public.角色
  for select to authenticated using (true);

drop policy if exists 登录可读权限点 on public.权限点;
create policy 登录可读权限点 on public.权限点
  for select to authenticated using (true);

drop policy if exists 登录可读角色权限 on public.角色-权限;
create policy 登录可读角色权限 on public.角色-权限
  for select to authenticated using (true);

drop policy if exists 仅本人可读用户角色 on public.用户-角色;
create policy 仅本人可读用户角色 on public.用户-角色
  for select to authenticated using (用户 = auth.uid());

-- ══════════════ 种子 ══════════════
insert into public.角色 (名称, 备注) values
  ('学生', '默认角色：按摩擦力规则解锁提示与参考答案'),
  ('助教', '答疑场景：挂「随时查看参考答案」，往往同时持有学生角色'),
  ('教师', '备课与答疑：挂「随时查看参考答案」')
on conflict (名称) do nothing;

insert into public.权限点 (名称, 备注) values
  ('随时查看参考答案', '第一版唯一启用的权限点：免摩擦力门槛直接查看，且不构成「借助答案」（ADR-0003 修订 v3）'),
  ('编辑题库', '占位：待题库编辑功能实现时启用'),
  ('安排练习', '占位：待个性化安排测试功能实现时启用'),
  ('查看学情', '占位：待学情采集统计功能实现时启用')
on conflict (名称) do nothing;

-- 「随时查看参考答案」仅挂助教、教师；占位权限点不挂任何角色（预定义零成本，YAGNI）
insert into public.角色-权限 (角色, 权限点)
values ('助教', '随时查看参考答案'), ('教师', '随时查看参考答案')
on conflict (角色, 权限点) do nothing;

-- ══════════════ 存量回填：已有档案的用户全部补挂学生角色 ══════════════
-- 回填前后行为无缝：学生角色无权限点，回填等价于摩擦力规则不变。
insert into public.用户-角色 (用户, 角色)
select id, '学生' from public.用户档案
on conflict (用户, 角色) do nothing;

-- ══════════════ 注册自动挂学生角色（建档触发器扩展） ══════════════
-- 复用 T1 的 注册时建立档案 触发器（security definer，绕过 RLS）：
-- 建档后同步插入 学生 角色持有（on conflict 幂等；角色由上方种子保证存在）。
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

  insert into public.用户-角色 (用户, 角色)
  values (new.id, '学生')
  on conflict (用户, 角色) do nothing;
  return new;
end;
$$;

-- 触发器本身已存在（T1 迁移创建），仅需函数重定义生效；保持声明幂等以防独立执行。
drop trigger if exists 注册时建立档案 on auth.users;
create trigger 注册时建立档案
  after insert on auth.users
  for each row execute function public.注册时建立档案();
