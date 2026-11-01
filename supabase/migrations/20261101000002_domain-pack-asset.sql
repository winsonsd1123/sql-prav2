-- 云端域包存储（issue #57 / spec #53 目标②，ADR-0008）：
-- 域包以 JSON 数据资产存两张表：
--   domain_pack_asset          当前最新版本（一行一个域包，pack_id 为主键，内容即资产本身）；
--   domain_pack_version_history 版本历史（为票 #62 版本化预留的表结构：每次 B 类变更存一代，
--                              本票只建结构，不实现版本化写入逻辑）。
-- 版本化约定（ADR-0009，本票只落约定不落逻辑）：历史行的 pack_id 存带版本后缀的完整 id
-- （如 student-course-grade@v2），当前表 pack_id 存不带后缀的基础名（基础名永不改）。
-- 写入路径（src/server/domain-pack-asset-service.ts）先过验证闸门强校验再落库，
-- 走 service_role 客户端（RLS 无写策略兜底，鉴权在 API 层，ADR-0007；教师端 API 见 #60）；
-- 读操作登录学生即可（学生端加载层合并云端域包，读走浏览器 anon 会话直连）。
-- 与 pack_exposure（#55）同口径：authenticated 可读、写仅 service_role。
-- 幂等：可重复执行。

-- ══════════════ 当前最新版本（domain_pack_asset） ══════════════
create table if not exists public.domain_pack_asset (
  pack_id text primary key,
  asset jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.domain_pack_asset is '云端域包当前最新版本：一行一个域包（pack_id 为不带版本后缀的基础名），asset 为过验证闸门的完整 JSON 资产；写入仅 service_role（经 API 层鉴权 + 闸门强校验），读取 authenticated（学生端加载层）';

-- ══════════════ 版本历史（domain_pack_version_history，#62 预留） ══════════════
create table if not exists public.domain_pack_version_history (
  id bigint generated always as identity primary key,
  pack_id text not null,
  version_label text not null,
  asset jsonb not null,
  created_at timestamptz not null default now(),
  unique (pack_id, version_label)
);

comment on table public.domain_pack_version_history is '域包版本历史（ADR-0009）：每次 B 类变更（库骨架/名称池/模板/数据规则）存一代不可变资产；pack_id 存带版本后缀的完整 id（如 xxx@v2）。本表结构为票 #62 预留，#57 不写入';

-- ══════════════ RLS：authenticated 可读、写仅 service_role（无写策略 = 兜底拒绝） ══════════════
alter table public.domain_pack_asset enable row level security;
alter table public.domain_pack_version_history enable row level security;

drop policy if exists authenticated_read_domain_pack_asset on public.domain_pack_asset;
create policy authenticated_read_domain_pack_asset on public.domain_pack_asset
  for select to authenticated using (true);

drop policy if exists authenticated_read_domain_pack_history on public.domain_pack_version_history;
create policy authenticated_read_domain_pack_history on public.domain_pack_version_history
  for select to authenticated using (true);
