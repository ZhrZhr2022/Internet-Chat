import React, { useRef, useEffect, useState } from 'react';
import EmojiPicker, { EmojiClickData, Theme } from 'emoji-picker-react';
import { QRCodeSVG } from 'qrcode.react';
import { Send, Image as ImageIcon, Smile, LogOut, Copy, Check, Users, Menu, X, Bot, MessageSquare, Share2, Link as LinkIcon, ZoomIn } from 'lucide-react';
import { usePeerChat } from '../hooks/usePeerChat';
import { MessageBubble } from './MessageBubble';
import { Button } from './Button';
import { MessageType, User } from '../types';

interface ChatScreenProps {
  chat: ReturnType<typeof usePeerChat>;
  onLeave: () => void;
}

export const ChatScreen: React.FC<ChatScreenProps> = ({ chat, onLeave }) => {
  const { state, currentUser, sendMessage, setTyping } = chat;
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [inputValue, setInputValue] = useState('');
  const [showEmoji, setShowEmoji] = useState(false);
  const [showSidebar, setShowSidebar] = useState(false);
  const [copied, setCopied] = useState(false);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  
  // Mentions State
  const [mentionSearch, setMentionSearch] = useState<string | null>(null);
  const [filteredUsers, setFilteredUsers] = useState<User[]>([]);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const typingTimeoutRef = useRef<any>(null);

  // Auto scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [state.messages, state.typingUsers]);

  // Handle Mention Search
  useEffect(() => {
    if (mentionSearch === null) {
      setFilteredUsers([]);
      return;
    }
    const search = mentionSearch.toLowerCase();
    const matches = state.users.filter(u => 
      u.name.toLowerCase().includes(search) && u.id !== currentUser?.id
    );
    // Always add AI
    if ('nexus ai'.includes(search)) {
      // Fake AI user for selection
       const aiUser = { id: 'ai', name: 'Nexus AI', color: '#10b981', isHost: false } as User;
       matches.push(aiUser);
    }
    setFilteredUsers(matches);
  }, [mentionSearch, state.users, currentUser]);

  const handleSendMessage = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!inputValue.trim()) return;
    sendMessage(inputValue.trim());
    setInputValue('');
    setShowEmoji(false);
    setMentionSearch(null);
    
    // Clear typing status immediately on send
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    setTyping(false);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setInputValue(value);
    
    // Mention Logic: Check if the last word starts with @
    const lastWord = value.split(' ').pop();
    if (lastWord && lastWord.startsWith('@')) {
      setMentionSearch(lastWord.substring(1)); // Search term without @
    } else {
      setMentionSearch(null);
    }

    // Typing indicator logic
    if (!typingTimeoutRef.current) {
      setTyping(true);
    }
    
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }
    
    // Stop typing after 2 seconds of inactivity
    typingTimeoutRef.current = setTimeout(() => {
      setTyping(false);
      typingTimeoutRef.current = null;
    }, 2000);
  };

  const handleMentionSelect = (name: string) => {
    // Replace the last word (the @part) with the full mention
    const words = inputValue.split(' ');
    words.pop(); // Remove partial
    const newText = [...words, `@${name} `].join(' ');
    setInputValue(newText);
    setMentionSearch(null);
    // Focus input back
    const inputEl = document.querySelector('input[type="text"]') as HTMLInputElement;
    if(inputEl) inputEl.focus();
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = reader.result as string;
        sendMessage(base64, MessageType.IMAGE);
      };
      reader.readAsDataURL(file);
    }
  };

  const onEmojiClick = (emojiData: EmojiClickData) => {
    setInputValue(prev => prev + emojiData.emoji);
  };

  const copyRoomLink = () => {
    const url = `${window.location.origin}${window.location.pathname}#${state.roomId}`;
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Filter out self from typing users
  const activeTypers = state.typingUsers.filter(name => name !== currentUser?.name);

  return (
    <div className="flex h-[100dvh] bg-[#0f172a] overflow-hidden">
      
      {/* Lightbox Overlay */}
      {selectedImage && (
        <div 
          className="fixed inset-0 z-[60] bg-black/95 flex items-center justify-center p-4 animate-fade-in"
          onClick={() => setSelectedImage(null)}
        >
          <button className="absolute top-4 right-4 text-white/70 hover:text-white p-2">
            <X size={32} />
          </button>
          <img 
            src={selectedImage} 
            alt="Full screen" 
            className="max-w-full max-h-full object-contain rounded-lg shadow-2xl"
          />
        </div>
      )}

      {/* Mobile Sidebar Overlay */}
      {showSidebar && (
        <div 
          className="fixed inset-0 bg-black/60 z-40 md:hidden backdrop-blur-sm"
          onClick={() => setShowSidebar(false)}
        />
      )}

      {/* Sidebar */}
      <div className={`
        fixed md:relative inset-y-0 left-0 w-80 bg-slate-900 border-r border-white/10 z-50 transform transition-transform duration-300 ease-in-out flex flex-col
        ${showSidebar ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
      `}>
        <div className="p-6 border-b border-white/5 flex items-center justify-between">
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Users size={20} className="text-indigo-400" />
            Room Info
          </h2>
          <button onClick={() => setShowSidebar(false)} className="md:hidden text-slate-400">
            <X size={24} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          
          {/* Room ID Card */}
          <div className="bg-slate-800/50 p-4 rounded-xl border border-white/5">
            <p className="text-xs text-slate-400 mb-2 uppercase tracking-wider font-semibold">Invite Friends</p>
            <div className="flex justify-center bg-white p-2 rounded-lg mb-4 w-fit mx-auto">
              <QRCodeSVG value={`${window.location.origin}${window.location.pathname}#${state.roomId}`} size={120} />
            </div>
            <div className="flex gap-2 mb-2">
              <input 
                readOnly 
                value={state.roomId || ''} 
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-300 font-mono"
              />
              <Button variant="secondary" size="sm" onClick={copyRoomLink}>
                {copied ? <Check size={16} /> : <Copy size={16} />}
              </Button>
            </div>
            
            {/* LAN Tip */}
            <div className="text-[10px] text-slate-500 bg-indigo-500/10 p-2 rounded-lg border border-indigo-500/20">
               <span className="text-indigo-400 font-bold block mb-1">📢 Connection Tip:</span> 
               Send the link to friends. They can join from any device.
            </div>
          </div>

          {/* User List */}
          <div>
             <p className="text-xs text-slate-400 mb-3 uppercase tracking-wider font-semibold">
               Online ({state.users.length})
             </p>
             <div className="space-y-2">
               {state.users.map(user => (
                 <div key={user.id} className="flex items-center gap-3 p-2 hover:bg-white/5 rounded-lg transition-colors">
                   <div 
                    className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white shadow-lg"
                    style={{ backgroundColor: user.color }}
                   >
                     {user.name.substring(0,2).toUpperCase()}
                   </div>
                   <div className="flex-1 min-w-0">
                     <p className="text-sm font-medium text-slate-200 truncate">
                       {user.name} 
                       {user.id === currentUser?.id && <span className="text-slate-500 ml-1">(You)</span>}
                     </p>
                     {user.isHost && <p className="text-[10px] text-indigo-400">HOST</p>}
                   </div>
                 </div>
               ))}
               <div className="flex items-center gap-3 p-2 hover:bg-white/5 rounded-lg transition-colors opacity-70">
                  <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white bg-gradient-to-br from-emerald-400 to-cyan-500 shadow-lg">
                    <Bot size={16} />
                  </div>
                   <div className="flex-1 min-w-0">
                     <p className="text-sm font-medium text-slate-200">Nexus AI</p>
                     <p className="text-[10px] text-emerald-400">BOT</p>
                   </div>
               </div>
             </div>
          </div>
        </div>

        <div className="p-4 border-t border-white/5">
          <Button variant="danger" className="w-full justify-center" onClick={onLeave}>
            <LogOut size={16} className="mr-2" />
            Leave Room
          </Button>
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col relative w-full h-full">
        {/* Header */}
        <header className="h-16 shrink-0 border-b border-white/5 bg-slate-900/50 backdrop-blur-md flex items-center justify-between px-4 sticky top-0 z-30">
          <div className="flex items-center gap-3">
            <button 
              className="md:hidden p-2 text-slate-300 hover:bg-white/5 rounded-lg"
              onClick={() => setShowSidebar(true)}
            >
              <Menu size={24} />
            </button>
            <div>
              <h3 className="font-bold text-white flex items-center gap-2">
                Nexus Chat
                <span className={`w-2 h-2 rounded-full ${state.status === 'connected' ? 'bg-emerald-500' : 'bg-yellow-500'} animate-pulse`} />
              </h3>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <Button 
              variant="secondary" 
              size="sm" 
              className={`hidden sm:flex items-center gap-2 border-indigo-500/30 ${copied ? 'bg-indigo-500/20 text-indigo-300' : ''}`}
              onClick={copyRoomLink}
            >
              {copied ? <Check size={16} /> : <Share2 size={16} />}
              {copied ? 'Copied!' : 'Share Link'}
            </Button>
            
            {/* Mobile Share Icon */}
            <button onClick={copyRoomLink} className="sm:hidden p-2 text-indigo-400 hover:bg-indigo-500/10 rounded-full">
               {copied ? <Check size={20} /> : <LinkIcon size={20} />}
            </button>
          </div>
        </header>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2 relative scroll-smooth">
          {state.messages.length === 0 && (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-500 opacity-50 pointer-events-none">
               <MessageSquare size={48} className="mb-2" />
               <p>No messages yet. Say hello!</p>
               <div className="mt-4 flex flex-col items-center gap-2 text-sm">
                 <p>Waiting for friends?</p>
                 <Button variant="secondary" size="sm" onClick={copyRoomLink}>
                    <Copy size={14} className="mr-2"/> Copy Invite Link
                 </Button>
               </div>
            </div>
          )}
          {state.messages.map((msg) => (
            <MessageBubble 
              key={msg.id} 
              message={msg} 
              isSelf={msg.senderId === currentUser?.id} 
              onImageClick={(src) => setSelectedImage(src)}
            />
          ))}
          <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        <div className="p-4 bg-slate-900 border-t border-white/5 relative shrink-0 z-20">
          
          {/* Typing Indicator */}
          {activeTypers.length > 0 && (
            <div className="absolute top-[-24px] left-6 text-xs text-indigo-300 animate-pulse flex items-center gap-1">
              <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce"></span>
              <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce delay-100"></span>
              <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce delay-200"></span>
              <span className="ml-1 font-medium">
                {activeTypers.join(', ')} {activeTypers.length > 1 ? 'are' : 'is'} typing...
              </span>
            </div>
          )}

          {/* Mention Popup */}
          {mentionSearch !== null && filteredUsers.length > 0 && (
             <div className="absolute bottom-20 left-4 bg-slate-800 border border-slate-700 rounded-xl shadow-xl overflow-hidden min-w-[200px] z-50 animate-slide-up">
                <div className="px-3 py-2 bg-slate-900/50 border-b border-slate-700 text-xs text-slate-400 font-semibold">
                  Mention user
                </div>
                <div className="max-h-48 overflow-y-auto">
                   {filteredUsers.map(u => (
                     <button
                       key={u.id}
                       className="w-full flex items-center gap-2 px-3 py-2 hover:bg-indigo-600/20 text-left transition-colors"
                       onClick={() => handleMentionSelect(u.name)}
                     >
                       <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white shadow-sm" style={{ backgroundColor: u.color || '#10b981' }}>
                         {u.name.substring(0,2).toUpperCase()}
                       </div>
                       <span className="text-sm text-slate-200 font-medium">{u.name}</span>
                     </button>
                   ))}
                </div>
             </div>
          )}

          <div className="max-w-4xl mx-auto flex items-end gap-2 bg-slate-800/50 p-2 rounded-2xl border border-white/10 relative">
            
            <button 
              className="p-3 text-slate-400 hover:text-indigo-400 hover:bg-white/5 rounded-xl transition-colors"
              onClick={() => setShowEmoji(!showEmoji)}
            >
              <Smile size={24} />
            </button>

            {showEmoji && (
               <div className="absolute bottom-16 left-0 z-50 animate-slide-up shadow-2xl rounded-2xl overflow-hidden">
                 <EmojiPicker 
                   theme={Theme.DARK} 
                   onEmojiClick={onEmojiClick} 
                   lazyLoadEmojis={true}
                   width={300}
                   height={400}
                 />
               </div>
            )}

            <button 
              className="p-3 text-slate-400 hover:text-indigo-400 hover:bg-white/5 rounded-xl transition-colors"
              onClick={() => fileInputRef.current?.click()}
            >
              <ImageIcon size={24} />
            </button>
            <input 
              type="file" 
              ref={fileInputRef} 
              className="hidden" 
              accept="image/*" 
              onChange={handleFileUpload}
            />

            <form onSubmit={handleSendMessage} className="flex-1 flex gap-2">
              <input
                type="text"
                value={inputValue}
                onChange={handleInputChange}
                placeholder="Type a message or @..."
                className="w-full bg-transparent text-white placeholder-slate-500 focus:outline-none py-3 px-2"
                enterKeyHint="send"
              />
              <Button 
                type="submit" 
                variant="primary" 
                className="rounded-xl px-4"
                disabled={!inputValue.trim()}
              >
                <Send size={20} />
              </Button>
            </form>
          </div>
        </div>

      </div>
    </div>
  );
};