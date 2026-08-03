import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import AuthPage from "./AuthPage";
import { Button } from "@/components/ui/button";

type AuthOAuth = {
  getAuthorizationDetails: (id: string) => Promise<{ data: any; error: any }>;
  approveAuthorization: (id: string) => Promise<{ data: any; error: any }>;
  denyAuthorization: (id: string) => Promise<{ data: any; error: any }>;
};

const oauth = () => (supabase.auth as unknown as { oauth: AuthOAuth }).oauth;

export default function OAuthConsentPage() {
  const [params] = useSearchParams();
  const authorizationId = params.get("authorization_id") ?? "";
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [details, setDetails] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Keep the consent URL intact: render the sign-in form inline instead of
  // navigating away, so approval continues right here after sign-in.
  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (active) setSignedIn(!!data.session);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setSignedIn(!!session);
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!signedIn) return;
    let active = true;
    (async () => {
      if (!authorizationId) {
        setError("Missing authorization_id");
        return;
      }
      const { data, error: detailsError } = await oauth().getAuthorizationDetails(authorizationId);
      if (!active) return;
      if (detailsError) {
        setError(detailsError.message);
        return;
      }
      const immediate = data?.redirect_url ?? data?.redirect_to;
      if (immediate && !data?.client) {
        window.location.href = immediate;
        return;
      }
      setDetails(data);
    })();
    return () => {
      active = false;
    };
  }, [signedIn, authorizationId]);

  const decide = async (approve: boolean) => {
    setBusy(true);
    const { data, error: decisionError } = approve
      ? await oauth().approveAuthorization(authorizationId)
      : await oauth().denyAuthorization(authorizationId);
    if (decisionError) {
      setBusy(false);
      setError(decisionError.message);
      return;
    }
    const target = data?.redirect_url ?? data?.redirect_to;
    if (!target) {
      setBusy(false);
      setError("No redirect returned by the authorization server.");
      return;
    }
    window.location.href = target;
  };

  const shell = (children: React.ReactNode) => (
    <main className="flex min-h-screen items-center justify-center parchment-bg p-4">
      <div className="w-full max-w-md rounded-lg border border-border bg-card p-6 shadow-xl">
        {children}
      </div>
    </main>
  );

  if (signedIn === null) {
    return shell(<p className="font-display text-primary animate-pulse">Consulting the archives…</p>);
  }

  if (!signedIn) return <AuthPage />;

  if (error) {
    return shell(
      <>
        <h1 className="font-display text-lg text-primary">Authorization failed</h1>
        <p className="mt-2 text-sm text-muted-foreground">{error}</p>
      </>,
    );
  }

  if (!details) {
    return shell(<p className="font-display text-primary animate-pulse">Loading authorization request…</p>);
  }

  const clientName = details.client?.name ?? "an application";

  return shell(
    <>
      <h1 className="font-display text-lg text-primary">Connect {clientName}</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        {clientName} is asking to act as you in Wayfarers of Varneth. It will be able to read your
        characters, their gear and the world locations you can see.
      </p>
      <div className="mt-6 flex gap-2">
        <Button disabled={busy} onClick={() => decide(true)} className="flex-1">
          {busy ? "Sealing…" : "Approve"}
        </Button>
        <Button disabled={busy} variant="outline" onClick={() => decide(false)} className="flex-1">
          Deny
        </Button>
      </div>
    </>,
  );
}
