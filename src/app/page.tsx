import Playground from "@/components/演练场";
import LoginGuard from "@/components/login-guard";

export default function Home() {
  return (
    <LoginGuard>
      <Playground />
    </LoginGuard>
  );
}
