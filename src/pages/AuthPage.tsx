import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';

export default function AuthPage() {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const { signIn, signUp } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (isLogin) {
        const { error } = await signIn(email, password);
        if (error) throw error;
      } else {
        const { error } = await signUp(email, password);
        if (error) throw error;
        toast.success('Check your email to confirm your account!');
      }
    } catch (err: any) {
      toast.error(err.message || 'Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center parchment-bg p-4">
      <Card className="w-full max-w-md ornate-border bg-card/90 backdrop-blur">
        <CardHeader className="text-center">
          <h1 className="font-display text-2xl text-primary text-glow mb-2 leading-tight">
            Wayfarers of Eldara <span className="text-sm text-muted-foreground font-body ml-1">v0.3.0</span>
          </h1>
          <CardTitle className="font-display text-xl text-foreground">
            {isLogin ? 'Enter the Realm' : 'Join the Fellowship'}
          </CardTitle>
          <p className="text-sm text-muted-foreground mt-1">
            {isLogin ? 'Sign in to continue your journey' : 'Create your account to begin'}
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-sm font-display text-foreground">Email</label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="wayfarer@eldara.com"
                required
                className="mt-1 bg-input border-border"
              />
            </div>
            <div>
              <label className="text-sm font-display text-foreground">Password</label>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                minLength={6}
                className="mt-1 bg-input border-border"
              />
            </div>
            <Button type="submit" disabled={loading} className="w-full font-display">
              {loading ? 'Journeying...' : isLogin ? 'Enter' : 'Create Account'}
            </Button>
          </form>
          <button
            onClick={() => setIsLogin(!isLogin)}
            className="mt-4 w-full text-center text-sm text-muted-foreground hover:text-primary transition-colors"
          >
            {isLogin ? "No account? Join the Fellowship" : "Already have an account? Enter"}
          </button>
        </CardContent>
      </Card>
    </div>
  );
}
