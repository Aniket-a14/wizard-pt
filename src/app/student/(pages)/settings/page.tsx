import { AccountSettings } from "@/components/account-settings";
import { PageHeader } from "@/components/ui/panel";
import { requireStudent } from "@/lib/auth/session";

export const metadata = { title: "Settings" };

export default async function StudentSettings() {
  const user = await requireStudent();
  return (
    <>
      <PageHeader title="Profile & settings" />
      <AccountSettings email={user.email} displayName={user.displayName} />
    </>
  );
}
