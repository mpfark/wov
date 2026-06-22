interface LoadingScreenProps {
  message?: string;
}

export function LoadingScreen({ message = "Loading your adventure..." }: LoadingScreenProps) {
  return (
    <div className="flex min-h-screen items-center justify-center parchment-bg">
      <p className="font-display text-primary text-glow animate-pulse">{message}</p>
    </div>
  );
}

export default LoadingScreen;
