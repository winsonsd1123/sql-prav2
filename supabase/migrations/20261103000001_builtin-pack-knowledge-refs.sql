-- 内置包知识点清单引用化（issue #84 / spec #75，ADR 0010）：
-- 把内置两包 domain_pack_asset 行的知识点清单转为词表引用形态——新增 knowledgeAreaRefIds
-- （与 knowledgeAreas 等长、逐位对齐的词表条目 id 有序数组），knowledgeAreas 名称清单本体不动：
-- 归一化读取（#83）只读名称，故同种子抽题字节级复现不变；引用 id 按名称逐位 join 词表取得，
-- 与词表同源不双写（词表初始数据由 20261102000001 从同一批资产展开种子）。
-- 直接改写资产行、不经写入服务与版本分类路径：packId 与版本历史零变更（ADR 0009）。
-- 幂等：已有引用数组的行跳过；名称未全部命中词表（词表被教师改名）则保持自由形态，
-- 不产出不等长的非法引用数组（契约 parseDomainPackJson 会拒绝）。
-- updated_at 由既有 set_updated_at 触发器随行更新，此处不重复赋值。

update public.domain_pack_asset
set asset = jsonb_set(asset, '{knowledgeAreaRefIds}', (
      -- 按清单顺序（ordinality）逐位取词表条目 id，保证与名称逐位对齐
      select jsonb_agg(ka.id::text order by elem.ord)
      from jsonb_array_elements_text(asset->'knowledgeAreas') with ordinality as elem(name, ord)
      join public.knowledge_area ka on ka.name = elem.name
    ))
where pack_id in ('student-course-grade', 'employee-department-payroll')
  and not asset ? 'knowledgeAreaRefIds'
  and (
    -- 名称逐位全部命中词表才转换（任一缺失即保持自由形态）
    select count(*) = jsonb_array_length(asset->'knowledgeAreas')
    from jsonb_array_elements_text(asset->'knowledgeAreas') as elem(name)
    join public.knowledge_area ka on ka.name = elem.name
  );
