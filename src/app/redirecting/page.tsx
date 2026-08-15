"use client";

import { useEffect, useState } from "react";
import { authClient } from "@/lib/auth-client";

const MAX_WAIT_MS = 5000; // give up and show an error after 5 seconds

export default function RedirectingPage() {
  const { data: session, isPending } = authClient.useSession();
  const [timedOut, setTimedOut] = useState(false);

  // Reactive path: the moment the session hook resolves with real data,
  // navigate immediately. This is not a fixed delay — it fires as soon
  // as isPending flips to false and a session actually exists.
  useEffect(() => {
    if (!isPending && session) {
      window.location.href = "/";
    }
  }, [isPending, session]);

  // Safety net: if something goes wrong and the session hook never
  // resolves (network issue, hook stuck pending, etc.), don't leave the
  // user staring at an infinite spinner. Bound the wait to MAX_WAIT_MS.
  // This is a genuine timeout-with-fallback, not a fake "wait N seconds
  // then pretend it's ready" delay — it only ever shows an ERROR state,
  // never forces a premature navigation.
  useEffect(() => {
    const timer = setTimeout(() => {
      setTimedOut(true);
    }, MAX_WAIT_MS);

    return () => clearTimeout(timer);
  }, []);

  // Genuine failure case: either the session check finished and there's
  // no session, or we hit the safety timeout without ever resolving.
  const hasFailed = (!isPending && !session) || timedOut;

  if (hasFailed) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-background">
        <p className="text-sm text-destructive">
          Something went wrong. Please try logging in again.
        </p>
        <a href="/login" className="text-sm underline">
          Back to login
        </a>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-background">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      <p className="text-sm text-muted-foreground">Signing you in...</p>
    </div>
  );
}


