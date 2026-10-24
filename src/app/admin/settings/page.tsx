import { AccountSettings } from "@/components/account-settings";
import { PageHeader } from "@/components/ui/panel";
import { requireAdmin } from "@/lib/auth/session";
import { RunnerStatus } from "./runner-status";

export const metadata = { title: "Settings" };

export default async function AdminSettings() {
  const user = await requireAdmin();
  const provider = (process.env.RUNNER_PROVIDER ?? "judge0").toLowerCase();
  return (
    <>
      <PageHeader title="Settings" />
      <div className="space-y-5">
        <RunnerStatus provider={provider} />
        <AccountSettings email={user.email} displayName={user.displayName} />
      </div>
    </>
  );
}
