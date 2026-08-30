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
import { registerService } from "@/services/auth.api";
import {
  type RegisterDto,
  registerSchema,
} from "@/validations/auth.validation";

export function RegisterForm() {
  const router = useRouter();
  const form = useForm<RegisterDto>({
    resolver: zodResolver(registerSchema),
    defaultValues: { name: "", email: "", password: "" },
  });

  const { mutateAsync, error } = useMutation({
    mutationFn: registerService,
    onSuccess: () => {
      router.replace("/dashboard");
    },
  });

  async function onSubmit(data: RegisterDto) {
    await mutateAsync(data);
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
      <Controller
        name="name"
        control={form.control}
        render={({ field, fieldState: { error } }) => (
          <Field>
            <div className="flex w-full items-center justify-between">
              <FieldLabel>Name</FieldLabel>
              {error && (
                <FieldError className="flex items-center gap-1">
                  <AlertCircleIcon className="size-3.5" />
                  {error.message}
                </FieldError>
              )}
            </div>
            <Input placeholder="Enter your name" {...field} />
          </Field>
        )}
      />
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
            <PasswordInput placeholder="Create a password" {...field} />
          </Field>
        )}
      />
      {error && (
        <Alert variant="destructive">
          <AlertCircleIcon />
          <AlertTitle>Registration Failed</AlertTitle>
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
        Register
      </Button>
    </form>
  );
}
