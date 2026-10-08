import { requireAdmin } from "@/lib/server/auth";
import { Heading } from "@/components/ui";
import AdminLogin from "@/components/admin-login";
import OperationsConsole from "@/components/operations-console";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "Administrator",
  robots: { index: false, follow: false },
};
export default async function Page() {
  let authenticated = false;
  try {
    await requireAdmin();
    authenticated = true;
  } catch {}
  return (
    <main className="page-content">
      <Heading
        label="AIRTIME / OPERATOR"
        title="The broadcast desk."
        description="Creator submissions, compliance review, finalized payments and automated Vibe operations."
      />
      {authenticated ? <OperationsConsole /> : <AdminLogin />}
    </main>
  );
}
