import React, { useState, useEffect } from 'react';
import { MessageSquare, Users, Zap, Shield } from 'lucide-react';
import { Button } from './Button';

interface WelcomeScreenProps {
  onCreate: (name: string) => void;
  onJoin: (id: string, name: string) => void;
}

export const WelcomeScreen: React.FC<WelcomeScreenProps> = ({ onCreate, onJoin }) => {
  const [name, setName] = useState('');
  const [inviteId, setInviteId] = useState('');
  const [mode, setMode] = useState<'menu' | 'join' | 'create'>('menu');

  useEffect(() => {
    // Check for hash invite
    const hash = window.location.hash.replace('#', '');
    if (hash) {
      setInviteId(hash);
      setMode('join');
    }
  }, []);

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim()) onCreate(name);
  };

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim() && inviteId.trim()) onJoin(inviteId, name);
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden">
      {/* Background Blobs */}
      <div className="absolute top-[-10%] left-[-10%] w-96 h-96 bg-purple-600/30 rounded-full blur-3xl animate-pulse"></div>
      <div className="absolute bottom-[-10%] right-[-10%] w-96 h-96 bg-indigo-600/30 rounded-full blur-3xl animate-pulse delay-1000"></div>

      <div className="w-full max-w-md z-10 animate-fade-in">
        <div className="bg-slate-900/50 backdrop-blur-xl border border-white/10 p-8 rounded-3xl shadow-2xl">
          
          <div className="text-center mb-8">
            <div className="w-16 h-16 bg-gradient-to-tr from-indigo-500 to-purple-500 rounded-2xl mx-auto flex items-center justify-center mb-4 shadow-lg shadow-indigo-500/20">
              <MessageSquare className="text-white" size={32} />
            </div>
            <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-slate-400">
              Nexus Chat
            </h1>
            <p className="text-slate-400 mt-2 text-sm">
              Secure, serverless, peer-to-peer conversations.
            </p>
          </div>

          {mode === 'menu' && (
            <div className="space-y-3">
              <Button 
                variant="primary" 
                className="w-full h-12 text-lg" 
                onClick={() => setMode('create')}
                icon={<Zap size={20} />}
              >
                Create New Room
              </Button>
              <Button 
                variant="secondary" 
                className="w-full h-12 text-lg" 
                onClick={() => setMode('join')}
                icon={<Users size={20} />}
              >
                Join Existing Room
              </Button>
              
              <div className="pt-6 grid grid-cols-2 gap-4">
                <div className="bg-white/5 p-3 rounded-xl border border-white/5 text-center">
                   <Shield size={20} className="mx-auto mb-2 text-emerald-400"/>
                   <p className="text-xs text-slate-400">P2P Encrypted</p>
                </div>
                <div className="bg-white/5 p-3 rounded-xl border border-white/5 text-center">
                   <Users size={20} className="mx-auto mb-2 text-blue-400"/>
                   <p className="text-xs text-slate-400">Unlimited Peers</p>
                </div>
              </div>
            </div>
          )}

          {mode === 'create' && (
            <form onSubmit={handleCreate} className="space-y-4 animate-slide-up">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">Your Display Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full bg-slate-800/50 border border-slate-700 rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all outline-none placeholder-slate-500"
                  placeholder="e.g. Maverick"
                  required
                />
              </div>
              <div className="flex gap-3 pt-2">
                <Button type="button" variant="ghost" className="flex-1" onClick={() => setMode('menu')}>Back</Button>
                <Button type="submit" className="flex-1">Start Chatting</Button>
              </div>
            </form>
          )}

          {mode === 'join' && (
            <form onSubmit={handleJoin} className="space-y-4 animate-slide-up">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">Room ID</label>
                <input
                  type="text"
                  value={inviteId}
                  onChange={(e) => setInviteId(e.target.value)}
                  className="w-full bg-slate-800/50 border border-slate-700 rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all outline-none placeholder-slate-500 font-mono text-sm"
                  placeholder="Paste Room ID here"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">Your Display Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full bg-slate-800/50 border border-slate-700 rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all outline-none placeholder-slate-500"
                  placeholder="e.g. Goose"
                  required
                />
              </div>
              <div className="flex gap-3 pt-2">
                <Button type="button" variant="ghost" className="flex-1" onClick={() => setMode('menu')}>Back</Button>
                <Button type="submit" className="flex-1">Join Room</Button>
              </div>
            </form>
          )}

        </div>
        
        <p className="text-center text-slate-500 text-xs mt-6">
          Powered by WebRTC & Gemini AI. Messages are ephemeral.
        </p>
      </div>
    </div>
  );
};