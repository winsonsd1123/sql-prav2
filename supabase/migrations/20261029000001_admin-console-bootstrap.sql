-- T1 · 后台管理骨架（issue #42 / spec #41，ADR-0005 / ADR-0007）
-- 新增权限点「访问后台」与角色「管理员」种子；管理员挂载权限点；
-- 当前持有「教师」角色的用户补挂「管理员」（首任管理员 bootstrap，无教师用户的环境静默跳过）；
-- RLS 策略零改动（管理读写走 service_role 属后续票）；一切判定只认权限点不认角色。
-- 幂等：可重复执行，种子可从迁移文件完整重建。

-- ══════════════ 种子：权限点与角色 ══════════════
insert into public.permissions (name, note) values
  ('访问后台', '进入后台管理（/admin）的能力：持有点者可见演练场入口并通过界面守卫；管理 API 鉴权同认此点（ADR-0007）')
on conflict (name) do nothing;

insert into public.roles (name, note) values
  ('管理员', '后台管理者：挂「访问后台」，经后台界面管理用户与邮箱白名单（GLOSSARY「后台管理」）')
on conflict (name) do nothing;

-- ══════════════ 挂载：管理员 → 访问后台 ══════════════
insert into public.role_permissions (role, permission)
values ('管理员', '访问后台')
on conflict (role, permission) do nothing;

-- ══════════════ 回填：现有教师 → 首任管理员 ══════════════
-- 迁移时点的一次性快照（此后管理员变更走后台界面自身）；
-- select 无教师行时 insert 零行，无教师用户的环境静默跳过。
insert into public.user_roles (user_id, role)
select user_id, '管理员' from public.user_roles where role = '教师'
on conflict (user_id, role) do nothing;
