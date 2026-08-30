"use client";

import { logout } from "@/actions/auth.action";
import { Button } from "@/components/ui/button";

// Calls the action directly rather than wrapping a <form>: this button sits
// inside the change-password form on the account panel, and a nested <form> is
// invalid HTML that the browser drops on hydration.
export function LogoutButton() {
  return (
    <Button type="button" variant="outline" onClick={() => logout()}>
      Log out
    </Button>
  );
}
