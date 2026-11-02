-- domain_pack_asset.updated_at 随行更新（票 #62 收口 #57 遗留）：
-- #57 建表时遗漏更新触发器——upsert 冲突更新（on conflict do update）不刷新 updated_at，
-- 演练配置保存与微调生效（A 类直更 / B 类换版本）都会让行内容变化而时间戳滞留，
-- 管理端无法凭 updated_at 判断「最近一次改动」。复用 practice_progress 同款触发器函数
-- （public.set_updated_at，20261028000003 已建，此处只补挂触发器）。
-- 幂等：可重复执行。

drop trigger if exists set_domain_pack_asset_updated_at on public.domain_pack_asset;
create trigger set_domain_pack_asset_updated_at
  before update on public.domain_pack_asset
  for each row execute function public.set_updated_at();
