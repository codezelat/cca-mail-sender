import { AuthForm } from "@/components/auth/auth-form";

type LoginPageProps = {
  searchParams?: Promise<{ next?: string | string[] | undefined }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = (await searchParams) || {};
  const nextPath = Array.isArray(params.next) ? params.next[0] : params.next;
  return <AuthForm mode="login" nextPath={nextPath} />;
}
