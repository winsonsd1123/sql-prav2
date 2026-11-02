-- 知识点词表（issue #79 / spec #75，ADR 0010）：
-- 全局「知识点词表」作为知识点的唯一来源：条目含名称（唯一）与描述，可启停；
-- 域包后续票（#82/#83）持有从词表圈选的有序引用清单，引用形态落地后被引用条目禁物理删除。
-- 写入仅 service_role（经 API 层鉴权——「访问后台」+「知识点词表管理」双权限点，ADR-0007；
-- RLS 无写策略兜底，与域包资产 / 放出清单同口径）；读取 authenticated（浏览器侧只读）。
-- 初始数据：内置两包既有知识点清单合并去重（ADR 0010），从 domain_pack_asset 的
-- knowledgeAreas 数组展开种子，与内置包资产同源不双写；描述留空待教师补写。
-- 幂等：可重复执行，表结构与种子可从迁移文件完整重建。

-- ══════════════ 词表（knowledge_area） ══════════════
create table if not exists public.knowledge_area (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.knowledge_area is '全局知识点词表（ADR 0010）：知识点的唯一来源，条目含名称（唯一）与描述、可启停；写入仅 service_role（经 API 层双权限点鉴权），读取 authenticated';

-- ══════════════ RLS：authenticated 可读、写仅 service_role（无写策略 = 兜底拒绝） ══════════════
alter table public.knowledge_area enable row level security;

drop policy if exists authenticated_read_knowledge_area on public.knowledge_area;
create policy authenticated_read_knowledge_area on public.knowledge_area
  for select to authenticated using (true);

-- ══════════════ 种子①：内置两包知识点清单合并去重作初始词表 ══════════════
-- 从 domain_pack_asset（内置包已由 20261101000003 种子）展开 knowledgeAreas 数组，
-- 合并去重后入库；on conflict 防重跑与教师已改名条目冲突。
insert into public.knowledge_area (name, description)
select distinct on (value) value, ''
from public.domain_pack_asset,
     jsonb_array_elements_text(asset->'knowledgeAreas') as value
on conflict (name) do nothing;

-- ══════════════ 种子②：权限点「知识点词表管理」并挂载教师、管理员 ══════════════
insert into public.permissions (name, note) values
  ('知识点词表管理', '维护全局知识点词表条目（/admin 知识点词表页与 API：增删改查与启停）的能力：知识点的唯一来源（ADR 0010）')
on conflict (name) do nothing;

insert into public.role_permissions (role, permission)
values ('教师', '知识点词表管理'), ('管理员', '知识点词表管理')
on conflict (role, permission) do nothing;

-- ══════════════ updated_at 随行更新（复用 set_updated_at，照 domain_pack_asset 触发器先例） ══════════════
drop trigger if exists set_knowledge_area_updated_at on public.knowledge_area;
create trigger set_knowledge_area_updated_at
  before update on public.knowledge_area
  for each row execute function public.set_updated_at();
