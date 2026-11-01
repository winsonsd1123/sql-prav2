-- 域包放出清单（issue #55 / spec #53 目标③，GLOSSARY「域包放出」）
-- 系统级清单表 pack_exposure：一行 = 一个已放出的域包 id（域包粒度，不按班级/学生组拆分）；
-- **表空 = 未配置 = 默认全部放出**（向后兼容，升级后现有学生无感）；「全不放」是有意的空清单配置，
-- 两种空语义由应用层过滤纯函数区分（src/lib/pack-exposure.ts）。
-- 写操作仅限持权限点「域包管理」者，判定在 API 层（ADR-0007）经 service_role 落库，RLS 兜底；
-- 读操作登录学生即可（学生端需读清单过滤可演练列表，读走浏览器 anon 会话直连）。
-- 幂等：可重复执行，表结构与种子可从迁移文件完整重建。

-- ══════════════ 放出清单（pack_exposure） ══════════════
create table if not exists public.pack_exposure (
  pack_id text primary key,
  created_at timestamptz not null default now()
);

comment on table public.pack_exposure is '系统级域包放出清单：一行一个已放出的域包 id；表空 = 未配置 = 默认全部放出（写仅限持「域包管理」权限点者，经 API 层 service_role）';

-- ══════════════ RLS ══════════════
-- 学生端要读清单过滤可演练列表：登录用户可读；写一律走 service_role（管理 API 鉴权后才可达）。
alter table public.pack_exposure enable row level security;

drop policy if exists authenticated_read_pack_exposure on public.pack_exposure;
create policy authenticated_read_pack_exposure on public.pack_exposure
  for select to authenticated using (true);

-- ══════════════ 种子：权限点「域包管理」并挂载教师、管理员 ══════════════
-- 判定只认权限点不认角色（ADR-0005）：挂载是给现有角色发默认能力，后续可经后台自由调整。
insert into public.permissions (name, note) values
  ('域包管理', '管理系统级域包放出清单（/admin 域包放出区块与 API）的能力：决定学生端可见的域包（spec #53 目标③）')
on conflict (name) do nothing;

insert into public.role_permissions (role, permission)
values ('教师', '域包管理'), ('管理员', '域包管理')
on conflict (role, permission) do nothing;
