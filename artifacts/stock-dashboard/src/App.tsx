import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import Home from "@/pages/Home";
import { PasscodeGate } from "@/components/PasscodeGate";
import { AuthLanding } from "@/components/AuthLanding";
import { ClerkProvider, Show, SignIn, SignUp } from "@clerk/react";
import { publishableKeyFromHost } from "@clerk/react/internal";
import { shadcn } from "@clerk/themes";
import { useLocation } from "wouter";

const queryClient = new QueryClient();
const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;

if (!clerkPubKey) {
  throw new Error("Missing VITE_CLERK_PUBLISHABLE_KEY");
}

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || "/"
    : path;
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={HomeRoute} />
      <Route path="/sign-in/*?" component={SignInPage} />
      <Route path="/sign-up/*?" component={SignUpPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function HomeRoute() {
  return (
    <>
      <Show when="signed-in">
        <PasscodeGate>
          <QueryClientProvider client={queryClient}>
            <TooltipProvider>
              <Home />
              <Toaster />
            </TooltipProvider>
          </QueryClientProvider>
        </PasscodeGate>
      </Show>
      <Show when="signed-out">
        <AuthLanding />
      </Show>
    </>
  );
}

function SignInPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} />
    </div>
  );
}

function SignUpPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} />
    </div>
  );
}

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();
  const clerkAppearance = {
    theme: shadcn,
    cssLayerName: "clerk",
    options: {
      logoPlacement: "inside" as const,
      logoLinkUrl: basePath || "/",
      logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
    },
    variables: {
      colorPrimary: "hsl(221 83% 35%)",
      colorForeground: "hsl(222 47% 11%)",
      colorMutedForeground: "hsl(215 16% 47%)",
      colorDanger: "hsl(0 72% 51%)",
      colorBackground: "hsl(0 0% 100%)",
      colorInput: "hsl(0 0% 100%)",
      colorInputForeground: "hsl(222 47% 11%)",
      colorNeutral: "hsl(214 20% 88%)",
      fontFamily: "Inter, sans-serif",
      borderRadius: "0.75rem",
    },
    elements: {
      rootBox: "w-full flex justify-center",
      cardBox: "w-[440px] max-w-full overflow-hidden rounded-2xl bg-white shadow-xl",
      card: "!border-0 !bg-transparent !shadow-none",
      footer: "!border-0 !bg-transparent !shadow-none",
      headerTitle: "text-slate-950",
      headerSubtitle: "text-slate-600",
      socialButtonsBlockButtonText: "text-slate-800",
      formFieldLabel: "text-slate-800",
      footerActionLink: "text-blue-800",
      footerActionText: "text-slate-600",
      dividerText: "text-slate-500",
      identityPreviewEditButton: "text-blue-800",
      formFieldSuccessText: "text-emerald-700",
      alertText: "text-slate-800",
      logoBox: "mb-2",
      logoImage: "h-12 w-12",
      socialButtonsBlockButton: "border-slate-200 bg-white",
      formButtonPrimary: "bg-blue-800",
      formFieldInput: "border-slate-300 bg-white text-slate-950",
      footerAction: "border-slate-200",
      dividerLine: "bg-slate-200",
      alert: "border-slate-200 bg-slate-50",
      otpCodeFieldInput: "border-slate-300 text-slate-950",
      formFieldRow: "gap-1",
      main: "gap-4",
    },
  };

  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={clerkAppearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <Router />
    </ClerkProvider>
  );
}

function App() {
  return (
    <WouterRouter base={basePath}>
      <ClerkProviderWithRoutes />
    </WouterRouter>
  );
}

export default App;
