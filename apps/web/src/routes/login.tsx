import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { Button } from "../components/ui/button.js";
import { Input } from "../components/ui/input.js";
import { FieldLabel } from "../components/ui/label.js";
import { signIn } from "../lib/auth-client.js";
import { ensureMe, invalidateMe } from "../lib/session.js";

export const Route = createFileRoute("/login")({
  beforeLoad: async ({ context }) => {
    const me = await ensureMe(context.queryClient);
    if (me) throw redirect({ to: "/admin" });
  },
  component: LoginPage,
});

interface LoginForm {
  email: string;
  password: string;
}

function LoginPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [submitting, setSubmitting] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginForm>({ mode: "onBlur" });

  async function onSubmit(values: LoginForm) {
    setSubmitting(true);
    const { error } = await signIn.email({ email: values.email, password: values.password });
    setSubmitting(false);
    if (error) {
      toast("Kirjautuminen epäonnistui. Tarkista sähköposti ja salasana.");
      return;
    }
    // The guards read a cached `me`; refresh it so /admin sees the new session.
    await invalidateMe(queryClient);
    await navigate({ to: "/admin" });
  }

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-14">
      <div className="w-full max-w-[400px] rounded-xl border border-hairline bg-surface p-7 md:p-8">
        <div className="mb-6 flex flex-col gap-2 text-center">
          <h1 className="font-display text-[24px] font-bold tracking-[-0.02em]">Kirjaudu sisään</h1>
          <p className="text-sm text-muted">Toimituksen työkalut — ehdotusjono ja julkaisut.</p>
        </div>

        <form
          onSubmit={(e) => void handleSubmit(onSubmit)(e)}
          noValidate
          className="flex flex-col gap-4"
        >
          <div className="flex flex-col gap-1.5">
            <FieldLabel htmlFor="email">Sähköposti</FieldLabel>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              autoFocus
              aria-invalid={!!errors.email}
              {...register("email", { required: "Sähköposti vaaditaan" })}
            />
            {errors.email && (
              <p className="text-[13px] font-medium text-accent">{errors.email.message}</p>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <FieldLabel htmlFor="password">Salasana</FieldLabel>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              aria-invalid={!!errors.password}
              {...register("password", { required: "Salasana vaaditaan" })}
            />
            {errors.password && (
              <p className="text-[13px] font-medium text-accent">{errors.password.message}</p>
            )}
          </div>
          <Button type="submit" size="lg" disabled={submitting} className="mt-1">
            {submitting ? "Kirjaudutaan…" : "Kirjaudu"}
          </Button>
        </form>
      </div>
    </main>
  );
}
