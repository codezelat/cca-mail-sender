import { AuthForm } from "@/components/auth/auth-form";

type SignupPageProps = {
  searchParams?: Promise<{ next?: string | string[] | undefined }>;
};

export default async function SignupPage({ searchParams }: SignupPageProps) {
  const params = (await searchParams) || {};
  const nextPath = Array.isArray(params.next) ? params.next[0] : params.next;
  return <AuthForm mode="signup" nextPath={nextPath} />;
}
