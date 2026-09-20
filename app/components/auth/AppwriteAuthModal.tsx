import React, { useState } from 'react';
import { useStore } from '@nanostores/react';
import {
  authStore,
  isAuthModalOpen,
  appwriteLogin,
  appwriteSignup,
  appwriteLoginWithGoogle,
  appwriteLoginWithDiscord,
} from '~/lib/auth/appwrite';
import { toast } from 'react-toastify';

export function AppwriteAuthModal() {
  const isOpen = useStore(isAuthModalOpen);
  const auth = useStore(authStore);

  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!email.trim() || !password.trim()) {
      setError('Please fill in both email and password.');
      return;
    }

    if (mode === 'signup' && !name.trim()) {
      setError('Please provide your name or creator handle.');
      return;
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters long.');
      return;
    }

    try {
      setLoading(true);
      if (mode === 'login') {
        await appwriteLogin(email, password);
        toast.success('Welcome back to THEFORTZ Studio!');
      } else {
        await appwriteSignup(name, email, password);
        toast.success('Account created! Welcome to THEFORTZ Studio!');
      }
    } catch (err: any) {
      console.error('[AuthModal] Error:', err);
      setError(err?.message || 'Authentication failed. Please check your credentials.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[99999] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in select-none"
      onClick={() => isAuthModalOpen.set(false)}
    >
      <div
        className="w-full max-w-md bg-[#0e1422] border border-[#10b981]/40 rounded-none p-6 sm:p-7 text-white shadow-2xl relative overflow-hidden"
        style={{
          boxShadow: '0 25px 60px -12px rgba(0, 0, 0, 0.9), 0 0 30px rgba(16, 185, 129, 0.15)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close Button */}
        <button
          onClick={() => isAuthModalOpen.set(false)}
          className="absolute top-4 right-4 text-white/60 hover:text-white p-1 rounded-none hover:bg-white/10 transition-all cursor-pointer"
          title="Close modal"
        >
          <div className="i-ph:x-bold text-lg" />
        </button>

        {/* Brand Header */}
        <div className="flex flex-col items-center text-center mb-5">
          <div className="w-14 h-14 rounded-none flex items-center justify-center mb-3 bg-[#090d16] border border-[#10b981]/40">
            <img
              src="/thefortzicon.png"
              alt="TheFortz"
              className="w-10 h-10 object-contain"
              onError={(e) => {
                const el = e.currentTarget as HTMLImageElement;
                el.style.display = 'none';
                const parent = el.parentElement;
                if (parent) {
                  parent.style.background = 'linear-gradient(135deg, #10b981, #8b5cf6)';
                  parent.textContent = '🎮';
                  parent.style.fontSize = '28px';
                }
              }}
            />
          </div>
          <h2
            className="text-2xl font-black uppercase tracking-wider text-emerald-400 font-['Anton',sans-serif]"
            style={{ textShadow: '0 2px 10px rgba(16,185,129,0.3)' }}
          >
            {mode === 'login' ? 'Sign In to THEFORTZ' : 'Create Creator Account'}
          </h2>
          <p className="text-xs text-slate-400 mt-1 max-w-xs">
            {mode === 'login'
              ? 'Connect your account to create games, sync progress, and publish to the live network.'
              : 'Join THEFORTZ to start building games with AI and earn creator rewards.'}
          </p>
        </div>

        {/* Tabs */}
        <div className="flex bg-[#090d16] p-1 rounded-none mb-5 border border-white/10">
          <button
            type="button"
            onClick={() => {
              setMode('login');
              setError('');
            }}
            className={`flex-1 py-1.5 text-xs font-bold rounded-none transition-all cursor-pointer ${
              mode === 'login'
                ? 'bg-[#10b981] text-black font-extrabold shadow-sm'
                : 'text-white/70 hover:text-white'
            }`}
          >
            Sign In
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('signup');
              setError('');
            }}
            className={`flex-1 py-1.5 text-xs font-bold rounded-none transition-all cursor-pointer ${
              mode === 'signup'
                ? 'bg-[#10b981] text-black font-extrabold shadow-sm'
                : 'text-white/70 hover:text-white'
            }`}
          >
            Create Account
          </button>
        </div>

        {/* OAuth Social Buttons */}
        <div className="grid grid-cols-2 gap-2.5 mb-4">
          <button
            type="button"
            onClick={() => appwriteLoginWithGoogle()}
            className="flex items-center justify-center gap-2 py-2 px-3 rounded-none bg-[#090d16] hover:bg-white/10 border border-white/15 hover:border-emerald-400/40 text-xs font-bold text-white transition-all cursor-pointer"
          >
            <div className="i-ph:google-logo-bold text-base text-red-400" />
            <span>Google</span>
          </button>
          <button
            type="button"
            onClick={() => appwriteLoginWithDiscord()}
            className="flex items-center justify-center gap-2 py-2 px-3 rounded-none bg-[#090d16] hover:bg-white/10 border border-white/15 hover:border-emerald-400/40 text-xs font-bold text-white transition-all cursor-pointer"
          >
            <div className="i-ph:discord-logo-bold text-base text-indigo-400" />
            <span>Discord</span>
          </button>
        </div>

        <div className="flex items-center gap-3 my-4">
          <div className="flex-1 h-px bg-white/15" />
          <span className="text-[11px] text-white/50 uppercase font-semibold">or with email</span>
          <div className="flex-1 h-px bg-white/15" />
        </div>

        {/* Error Banner */}
        {error && (
          <div className="mb-4 p-2.5 rounded-none bg-rose-950/80 border border-rose-500/60 text-rose-200 text-xs flex items-center gap-2 animate-shake">
            <span className="text-sm">⚠️</span>
            <span className="flex-1">{error}</span>
          </div>
        )}

        {/* Email & Password Form */}
        <form onSubmit={handleSubmit} className="space-y-3">
          {mode === 'signup' && (
            <div>
              <label className="block text-[11px] font-bold text-emerald-400 uppercase tracking-wider mb-1">
                Display Name / Creator Handle
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. PixelMaster99"
                required
                className="w-full px-3.5 py-2.5 rounded-none bg-[#060910] border border-white/20 text-white placeholder-white/30 text-xs focus:outline-none focus:border-emerald-400 transition-colors"
              />
            </div>
          )}

          <div>
            <label className="block text-[11px] font-bold text-emerald-400 uppercase tracking-wider mb-1">
              Email Address
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              className="w-full px-3.5 py-2.5 rounded-none bg-[#060910] border border-white/20 text-white placeholder-white/30 text-xs focus:outline-none focus:border-emerald-400 transition-colors"
            />
          </div>

          <div>
            <label className="block text-[11px] font-bold text-emerald-400 uppercase tracking-wider mb-1">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              className="w-full px-3.5 py-2.5 rounded-none bg-[#060910] border border-white/20 text-white placeholder-white/30 text-xs focus:outline-none focus:border-emerald-400 transition-colors"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full mt-2 py-3 px-4 rounded-none bg-[#f97316] hover:bg-[#ea580c] border border-orange-400/30 text-white font-extrabold text-xs uppercase tracking-wider transition-all shadow-lg active:translate-y-0.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <div className="i-svg-spinners:90-ring-with-bg text-base animate-spin" />
                <span>Processing...</span>
              </>
            ) : (
              <span>{mode === 'login' ? 'Sign In Now' : 'Create Free Account'}</span>
            )}
          </button>
        </form>

        <div className="text-center mt-4">
          <p className="text-[11px] text-white/50">
            Connected to THEFORTZ Network (Appwrite Cloud)
          </p>
        </div>
      </div>
    </div>
  );
}
