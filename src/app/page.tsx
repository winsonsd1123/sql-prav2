import 演练场 from "@/components/演练场";
import 登录守卫 from "@/components/登录守卫";

export default function Home() {
  return (
    <登录守卫>
      <演练场 />
    </登录守卫>
  );
}
