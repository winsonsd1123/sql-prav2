// #106 侧栏品牌区 SVG logo：等距数据库几何风格（三层圆柱堆叠，顶盖一处主色点缀）。
// 配色全部走 sidebar 主题 token（ADR-0011 单主题：深色侧栏），不写死色值——
// 主体 stroke 用 currentColor（由外层 text-sidebar-fg 决定），顶盖点缀用 text-primary。
// favicon 同图（src/app/icon.svg），但 favicon 无 CSS 上下文，故该处内联 token 等值色。

type BrandLogoProps = {
  /** 正方形边长（px），默认 28 */
  size?: number;
  className?: string;
};

export default function BrandLogo({ size = 28, className }: BrandLogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      role="img"
      aria-label="后台 logo"
      className={className}
    >
      {/* 侧壁：三层圆柱的左右轮廓线 */}
      <g stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        <path d="M5.5 8.5v15" />
        <path d="M26.5 8.5v15" />
        {/* 两道中层盖弧 + 底盖弧（下半椭圆） */}
        <path d="M5.5 13.5a10.5 4 0 0 0 21 0" />
        <path d="M5.5 18.5a10.5 4 0 0 0 21 0" />
        <path d="M5.5 23.5a10.5 4 0 0 0 21 0" />
      </g>
      {/* 顶盖：主色点缀 */}
      <ellipse cx="16" cy="8.5" rx="10.5" ry="4" className="fill-primary" />
    </svg>
  );
}
