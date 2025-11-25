import React, { useState, useEffect } from 'react';
import { WelcomeScreen } from './components/WelcomeScreen';
import { ChatScreen } from './components/ChatScreen';
import { usePeerChat } from './hooks/usePeerChat';
import { AlertCircle } from 'lucide-react';

const App: React.FC = () => {
  const chat = usePeerChat();
  const { state, createRoom, joinRoom } = chat;
  const [isInRoom, setIsInRoom] = useState(false);

  // Sync room state to UI
  useEffect(() => {
    if (state.status === 'connected') {
      setIsInRoom(true);
    }
  }, [state.status]);

  const handleCreate = (name: string) => {
    createRoom(name);
  };

  const handleJoin = (id: string, name: string) => {
    joinRoom(id, name);
  };

  const handleLeave = () => {
    window.location.reload(); // Simple reload to clear PeerJS state cleanly
  };

  return (
    <div className="font-sans text-slate-100 antialiased selection:bg-indigo-500/30">
      
      {/* Global Error Banner */}
      {state.error && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[100] animate-slide-up">
           <div className="bg-red-500/90 backdrop-blur-md text-white px-6 py-3 rounded-full shadow-lg flex items-center gap-2 border border-red-400/50">
             <AlertCircle size={20} />
             <span className="font-medium">{state.error}</span>
             <button onClick={() => window.location.reload()} className="ml-2 underline text-sm opacity-80 hover:opacity-100">Reload</button>
           </div>
        </div>
      )}

      {isInRoom ? (
        <ChatScreen chat={chat} onLeave={handleLeave} />
      ) : (
        <WelcomeScreen onCreate={handleCreate} onJoin={handleJoin} />
      )}
    </div>
  );
};

export default App;