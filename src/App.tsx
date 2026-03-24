import { lazy, Suspense } from "react";
import { PwaUpdatePrompt } from "@/components/PwaUpdatePrompt";
import { OfflineOverlay } from "@/components/OfflineOverlay";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { GameProvider } from "@/contexts/GameContext";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";

const GameRoute = lazy(() => import("./pages/GameRoute"));
const AdminRoute = lazy(() => import("./pages/AdminRoute"));

const queryClient = new QueryClient();

const LoadingFallback = () => (
  <div className="flex min-h-screen items-center justify-center parchment-bg">
    <p className="font-display text-primary text-glow animate-pulse">Loading...</p>
  </div>
);

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <PwaUpdatePrompt />
      <BrowserRouter>
        <GameProvider>
          <Suspense fallback={<LoadingFallback />}>
            <Routes>
              <Route path="/" element={<Index />} />
              <Route path="/game" element={<GameRoute />} />
              <Route path="/admin" element={<AdminRoute />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </GameProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
