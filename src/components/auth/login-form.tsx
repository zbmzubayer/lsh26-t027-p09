"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { AlertCircleIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Spinner } from "@/components/ui/spinner";
import { loginService } from "@/services/auth.api";
import { type LoginDto, loginSchema } from "@/validations/auth.validation";

export function LoginForm() {
  const router = useRouter();
  const form = useForm<LoginDto>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: "zbm.abir148025@gmail.com",
      password: "zbm.abir148025@gmail.com",
    },
  });

  const { mutateAsync, error } = useMutation({
    mutationFn: loginService,
    onSuccess: () => {
      router.replace("/dashboard");
    },
  });

  async function onSubmit(data: LoginDto) {
    await mutateAsync(data);
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
      <Controller
        name="email"
        control={form.control}
        render={({ field, fieldState: { error } }) => (
          <Field>
            <div className="flex w-full items-center justify-between">
              <FieldLabel>Email</FieldLabel>
              {error && (
                <FieldError className="flex items-center gap-1">
                  <AlertCircleIcon className="size-3.5" />
                  {error.message}
                </FieldError>
              )}
            </div>
            <Input placeholder="Enter your email" {...field} />
          </Field>
        )}
      />
      <Controller
        name="password"
        control={form.control}
        render={({ field, fieldState: { error } }) => (
          <Field>
            <div className="flex w-full items-center justify-between">
              <FieldLabel>Password</FieldLabel>
              {error && (
                <FieldError className="flex items-center gap-1">
                  <AlertCircleIcon className="size-3.5" />
                  {error.message}
                </FieldError>
              )}
            </div>
            <PasswordInput placeholder="Enter your password" {...field} />
          </Field>
        )}
      />
      {error && (
        <Alert variant="destructive">
          <AlertCircleIcon />
          <AlertTitle>Login Failed</AlertTitle>
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      )}
      <Button
        type="submit"
        disabled={form.formState.isSubmitting}
        focusableWhenDisabled
        className="w-full"
      >
        {form.formState.isSubmitting && <Spinner />}
        Login
      </Button>
    </form>
  );
}
