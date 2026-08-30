import { login, register } from "@/actions/auth.action";
import type { LoginDto, RegisterDto } from "@/validations/auth.validation";

export async function loginService(data: LoginDto) {
  const result = await login(data);
  if (!result.success) {
    throw new Error(result.error);
  }
  return result.data;
}

export async function registerService(data: RegisterDto) {
  const result = await register(data);
  if (!result.success) {
    throw new Error(result.error);
  }
  return result.data;
}
