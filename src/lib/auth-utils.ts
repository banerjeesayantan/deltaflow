import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "./auth";

const getSession = cache(async () => {
  return auth.api.getSession({
    headers: await headers(),
  });
});

export const requireAuth = async () => {
  const session = await getSession();

  if (!session) {
    redirect("/login");
  }

  return session;
};

export const requireUnauth = async () => {
  const session = await getSession();

  if (session) {
    redirect("/");
  }
};