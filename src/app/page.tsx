import Playground from "@/components/Playground";
import LoginGuard from "@/components/login-guard";

export default function Home() {
  return (
    <LoginGuard>
      <Playground />
    </LoginGuard>
  );
}
