
import React, { useRef, useEffect, useState } from 'react';
import EmojiPicker, { EmojiClickData, Theme } from 'emoji-picker-react';
import { QRCodeSVG } from 'qrcode.react';
import { Send, Image as ImageIcon, Smile, LogOut, Copy, Check, Users, Menu, X, Bot, MessageSquare, Share2, Link as LinkIcon, ArrowDown, Sparkles, AtSign, Ban, MicOff, Mic } from 'lucide-react';
import { usePeerChat } from '../hooks/usePeerChat';
import { MessageBubble } from './MessageBubble';
import { Button } from './Button';
import { MessageType, User } from '../types';

interface ChatScreenProps {
  chat: ReturnType<typeof usePeerChat>;
  onLeave: () => void;
}

// Utility to compress image to prevent P2P data choke
const compressImage = (base64: string, maxWidth = 800, quality = 0.7): Promise<string> => {
  return new Promise((resolve) => {
    const img = new Image();
    img.src = base64;
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let width = img.width;
      let height = img.height;

      if (width > maxWidth) {
        height = Math.round((height * maxWidth) / width);
        width = maxWidth;
      }

      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx?.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => resolve(base64); // Fallback if fail
  });
};

export const ChatScreen: React.FC<ChatScreenProps> = ({ chat, onLeave }) => {
  const { state, currentUser, isAiThinking, sendMessage, setTyping, kickUser, toggleMuteUser } = chat;
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  
  const [inputValue, setInputValue] = useState('');
  const [showEmoji, setShowEmoji] = useState(false);
  const [showSidebar, setShowSidebar] = useState(false);
  const [copied, setCopied] = useState(false);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  
  // Scroll & Notification State
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [unreadCount, setUnreadCount] = useState(0);
  const [hasUnreadMention, setHasUnreadMention] = useState(false);
  const prevMessagesLengthRef = useRef(0);
  
  // Mentions State
  const [mentionSearch, setMentionSearch] = useState<string | null>(null);
  const [filteredUsers, setFilteredUsers] = useState<User[]>([]);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const typingTimeoutRef = useRef<any>(null);
  const lastTypingSentRef = useRef<number>(0);

  // --- Scroll Logic ---
  
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    setUnreadCount(0);
    setHasUnreadMention(false);
  };

  const handleScroll = () => {
    if (!messagesContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = messagesContainerRef.current;
    // Increased threshold to 150 to be more forgiving with images
    const isBottom = scrollHeight - scrollTop - clientHeight < 150;
    setIsAtBottom(isBottom);
    if (isBottom) {
      setUnreadCount(0);
      setHasUnreadMention(false);
    }
  };

  // Effect: Handle new messages
  useEffect(() => {
    // Only react if message count actually increased (avoids false positives on re-renders)
    if (state.messages.length > prevMessagesLengthRef.current) {
      const lastMsg = state.messages[state.messages.length - 1];
      const isMention = currentUser && lastMsg.content.toLowerCase().includes(`@${currentUser.name.toLowerCase()}`);

      // If sent by me, force scroll. If I am at bottom, auto scroll.
      if (lastMsg.senderId === currentUser?.id || isAtBottom) {
        // Small timeout to allow render to finish (especially for images)
        setTimeout(scrollToBottom, 50);
      } else {
        setUnreadCount(prev => prev + 1);
        if (isMention) setHasUnreadMention(true);
      }
    }
    
    // Update ref for next run
    prevMessagesLengthRef.current = state.messages.length;
    
  }, [state.messages, currentUser]); // Removed isAtBottom from deps to prevent scroll jumping on scroll event

  // --- Search & Typing ---

  useEffect(() => {
    if (mentionSearch === null) {
      setFilteredUsers([]);
      return;
    }
    const search = mentionSearch.toLowerCase();
    const matches = state.users.filter(u => 
      u.name.toLowerCase().includes(search) && u.id !== currentUser?.id
    );
    setFilteredUsers(matches);
  }, [mentionSearch, state.users, currentUser]);

  const handleSendMessage = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!inputValue.trim() || currentUser?.isMuted) return;
    sendMessage(inputValue.trim());
    setInputValue('');
    setShowEmoji(false);
    setMentionSearch(null);
    
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    setTyping(false);
    lastTypingSentRef.current = 0;
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setInputValue(value);
    
    const words = value.split(' ');
    const lastWord = words[words.length - 1];
    
    if (lastWord && lastWord.startsWith('@')) {
      setMentionSearch(lastWord.substring(1));
    } else {
      setMentionSearch(null);
    }

    const now = Date.now();
    if (now - lastTypingSentRef.current > 1500) {
      setTyping(true);
      lastTypingSentRef.current = now;
    }
    
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    
    typingTimeoutRef.current = setTimeout(() => {
      setTyping(false);
      lastTypingSentRef.current = 0;
      typingTimeoutRef.current = null;
    }, 2000);
  };

  // --- Paste Handler (Images) ---
  const handlePaste = async (e: React.ClipboardEvent) => {
    if (currentUser?.isMuted) return;
    
    const items = e.clipboardData.items;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        e.preventDefault(); 
        const blob = items[i].getAsFile();
        if (blob) {
          const reader = new FileReader();
          reader.onloadend = async () => {
            const base64 = reader.result as string;
            // Compress before sending
            const compressed = await compressImage(base64);
            sendMessage(compressed, MessageType.IMAGE);
          };
          reader.readAsDataURL(blob);
        }
        return; 
      }
    }
  };

  const handleMentionSelect = (name: string) => {
    const words = inputValue.split(' ');
    words.pop();
    const newText = [...words, `@${name} `].join(' ');
    setInputValue(newText);
    setMentionSearch(null);
    inputRef.current?.focus();
  };

  const handleAtButtonClick = () => {
    if (currentUser?.isMuted) return;
    setInputValue(prev => prev + '@');
    setMentionSearch('');
    inputRef.current?.focus();
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (currentUser?.isMuted) return;
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = async () => {
        const base64 = reader.result as string;
        // Compress before sending
        const compressed = await compressImage(base64);
        sendMessage(compressed, MessageType.IMAGE);
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

  const activeTypers = state.typingUsers.filter(name => name !== currentUser?.name);

  const isMessageMentioningMe = (msg: any) => {
    if (!currentUser) return false;
    return msg.content.toLowerCase().includes(`@${currentUser.name.toLowerCase()}`);
  };

  return (
    <div className="flex h-[100dvh] bg-[#0f172a] overflow-hidden">
      
      {/* Lightbox Overlay */}
      {selectedImage && (
        <div 
          className="fixed inset-0 z-[100] bg-black/95 flex items-center justify-center p-4 animate-fade-in backdrop-blur-sm"
          onClick={() => setSelectedImage(null)}
        >
          <button className="absolute top-4 right-4 text-white/70 hover:text-white p-2 rounded-full hover:bg-white/10 transition-colors">
            <X size={32} />
          </button>
          <img 
            src={selectedImage} 
            alt="Full screen" 
            className="max-w-full max-h-[90dvh] object-contain rounded-lg shadow-2xl"
          />
        </div>
      )}

      {/* Mobile Sidebar Overlay */}
      {showSidebar && (
        <div 
          className="fixed inset-0 bg-black/60 z-[60] md:hidden backdrop-blur-sm transition-opacity"
          onClick={() => setShowSidebar(false)}
        />
      )}

      {/* Sidebar */}
      <div className={`
        fixed md:relative inset-y-0 left-0 w-80 bg-slate-900 border-r border-white/10 z-[70] transform transition-transform duration-300 ease-in-out flex flex-col h-full shadow-2xl md:shadow-none
        ${showSidebar ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
      `}>
        <div className="p-6 border-b border-white/5 flex items-center justify-between">
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Users size={20} className="text-indigo-400" />
            Room Info
          </h2>
          <button onClick={() => setShowSidebar(false)} className="md:hidden text-slate-400 p-2 hover:bg-white/10 rounded-lg">
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
          </div>

          {/* User List */}
          <div>
             <p className="text-xs text-slate-400 mb-3 uppercase tracking-wider font-semibold">
               Online ({state.users.length})
             </p>
             <div className="space-y-2">
               {state.users.map(user => (
                 <div key={user.id} className="group flex items-center gap-3 p-2 hover:bg-white/5 rounded-lg transition-colors relative">
                   <div className="relative">
                    <div 
                      className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white shadow-lg shrink-0"
                      style={{ backgroundColor: user.color }}
                    >
                      {user.name.substring(0,2).toUpperCase()}
                    </div>
                    {/* Status Dot */}
                    <div className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-slate-900 ${
                      user.status === 'away' ? 'bg-yellow-500' : 'bg-emerald-500'
                    }`} title={user.status || 'online'}></div>
                   </div>

                   <div className="flex-1 min-w-0">
                     <p className="text-sm font-medium text-slate-200 truncate flex items-center gap-1">
                       {user.name} 
                       {user.id === currentUser?.id && <span className="text-slate-500 ml-1">(You)</span>}
                       {user.isMuted && <MicOff size={12} className="text-red-400" />}
                     </p>
                     {user.isHost && <p className="text-[10px] text-indigo-400">HOST</p>}
                   </div>

                   {/* Admin Controls */}
                   {currentUser?.isHost && !user.isHost && user.id !== 'ai-bot' && (
                     <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                       <button 
                        onClick={() => toggleMuteUser(user.id)}
                        className={`p-1 rounded hover:bg-white/10 ${user.isMuted ? 'text-red-400' : 'text-slate-400'}`}
                        title={user.isMuted ? "Unmute" : "Mute"}
                       >
                         {user.isMuted ? <MicOff size={14}/> : <Mic size={14}/>}
                       </button>
                       <button 
                        onClick={() => kickUser(user.id)}
                        className="p-1 rounded hover:bg-red-500/20 text-slate-400 hover:text-red-400"
                        title="Kick User"
                       >
                         <Ban size={14}/>
                       </button>
                     </div>
                   )}
                 </div>
               ))}
             </div>
          </div>
        </div>

        <div className="p-4 border-t border-white/5 pb-8 md:pb-4">
          <Button variant="danger" className="w-full justify-center" onClick={onLeave}>
            <LogOut size={16} className="mr-2" />
            Leave Room
          </Button>
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col relative w-full h-[100dvh]">
        {/* Header */}
        <header className="h-14 md:h-16 shrink-0 border-b border-white/5 bg-slate-900/50 backdrop-blur-md flex items-center justify-between px-4 sticky top-0 z-30 shadow-sm">
          <div className="flex items-center gap-3">
            <button 
              className="md:hidden p-2 text-slate-300 hover:bg-white/5 rounded-lg active:scale-95 transition-transform"
              onClick={() => setShowSidebar(true)}
            >
              <Menu size={24} />
            </button>
            <div>
              <h3 className="font-bold text-white flex items-center gap-2 text-sm md:text-base">
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
            
            <button onClick={copyRoomLink} className="sm:hidden p-2 text-indigo-400 hover:bg-indigo-500/10 rounded-full active:scale-95 transition-transform">
               {copied ? <Check size={20} /> : <LinkIcon size={20} />}
            </button>
          </div>
        </header>

        {/* Messages */}
        <div 
          ref={messagesContainerRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto p-4 space-y-2 relative scroll-smooth overscroll-contain overflow-anchor-auto"
        >
          {state.messages.length === 0 && (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-500 opacity-50 pointer-events-none p-4 text-center">
               <MessageSquare size={48} className="mb-2" />
               <p>No messages yet.</p>
               <p className="text-xs mt-2">Invited friends? Messages are encrypted P2P.</p>
            </div>
          )}
          {state.messages.map((msg) => (
            <MessageBubble 
              key={msg.id} 
              message={msg} 
              isSelf={msg.senderId === currentUser?.id} 
              isMentioned={isMessageMentioningMe(msg)}
              onImageClick={(src) => setSelectedImage(src)}
            />
          ))}
          <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        <div className="p-2 md:p-4 bg-slate-900 border-t border-white/5 relative shrink-0 z-20 pb-[env(safe-area-inset-bottom)]">
          
          {/* FLOATING AREA: Notifications & Typing Indicators */}
          <div className="absolute bottom-full left-0 w-full px-4 pb-2 pointer-events-none flex flex-col items-center gap-2">
            
            {/* 1. New Message / Scroll Button */}
            {!isAtBottom && unreadCount > 0 && (
              <button 
                onClick={scrollToBottom}
                className={`pointer-events-auto shadow-xl px-4 py-2 rounded-full text-sm font-medium transition-all animate-slide-up flex items-center gap-2 ${
                  hasUnreadMention 
                    ? 'bg-yellow-500 text-slate-900 hover:bg-yellow-400' 
                    : 'bg-indigo-600 text-white hover:bg-indigo-500'
                }`}
              >
                <ArrowDown size={16} />
                {hasUnreadMention ? 'You were mentioned!' : `${unreadCount} New Messages`}
              </button>
            )}

            {/* 2. Typing Indicators (Users & AI) */}
            {(activeTypers.length > 0 || isAiThinking) && (
               <div className="pointer-events-auto bg-slate-800/90 backdrop-blur border border-white/10 px-4 py-2 rounded-2xl shadow-lg flex items-center gap-3 animate-slide-up mb-1">
                 {isAiThinking && (
                   <div className="flex items-center gap-2 text-emerald-400 border-r border-white/10 pr-3 mr-1">
                      <Sparkles size={14} className="animate-pulse" />
                      <span className="text-xs font-medium">Nexus AI is thinking...</span>
                   </div>
                 )}
                 {activeTypers.length > 0 && (
                   <div className="flex items-center gap-2 text-indigo-300">
                     <div className="flex gap-1">
                       <span className="w-1 h-1 bg-indigo-400 rounded-full animate-bounce"></span>
                       <span className="w-1 h-1 bg-indigo-400 rounded-full animate-bounce delay-100"></span>
                       <span className="w-1 h-1 bg-indigo-400 rounded-full animate-bounce delay-200"></span>
                     </div>
                     <span className="text-xs max-w-[150px] truncate">
                       {activeTypers.join(', ')} typing...
                     </span>
                   </div>
                 )}
               </div>
            )}
          </div>

          {/* Mention Popup */}
          {mentionSearch !== null && filteredUsers.length > 0 && (
             <div className="absolute bottom-full left-4 mb-2 bg-slate-800 border border-slate-700 rounded-xl shadow-xl overflow-hidden min-w-[200px] z-50 animate-slide-up">
                <div className="px-3 py-2 bg-slate-900/50 border-b border-slate-700 text-xs text-slate-400 font-semibold">
                  Mention user
                </div>
                <div className="max-h-48 overflow-y-auto">
                   {filteredUsers.map(u => (
                     <button
                       key={u.id}
                       className="w-full flex items-center gap-2 px-3 py-2 hover:bg-indigo-600/20 text-left transition-colors border-b border-white/5 last:border-0"
                       onClick={() => handleMentionSelect(u.name)}
                     >
                       <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white shadow-sm shrink-0" style={{ backgroundColor: u.color || '#10b981' }}>
                         {u.name.substring(0,2).toUpperCase()}
                       </div>
                       <span className="text-sm text-slate-200 font-medium truncate">{u.name}</span>
                     </button>
                   ))}
                </div>
             </div>
          )}

          <div className="max-w-4xl mx-auto flex items-end gap-2 bg-slate-800/80 p-1.5 md:p-2 rounded-2xl border border-white/10 relative shadow-sm">
            
            <div className="flex items-center gap-0.5 md:gap-1">
              <button 
                className="p-2 md:p-3 text-slate-400 hover:text-indigo-400 hover:bg-white/5 rounded-xl transition-colors disabled:opacity-30 disabled:cursor-not-allowed active:scale-95"
                onClick={() => setShowEmoji(!showEmoji)}
                disabled={!!currentUser?.isMuted}
              >
                <Smile size={20} className="md:w-6 md:h-6" />
              </button>

              <button 
                className="p-2 md:p-3 text-slate-400 hover:text-indigo-400 hover:bg-white/5 rounded-xl transition-colors disabled:opacity-30 disabled:cursor-not-allowed active:scale-95"
                onClick={handleAtButtonClick}
                title="Mention someone"
                disabled={!!currentUser?.isMuted}
              >
                <AtSign size={20} className="md:w-6 md:h-6" />
              </button>

              <button 
                className="p-2 md:p-3 text-slate-400 hover:text-indigo-400 hover:bg-white/5 rounded-xl transition-colors disabled:opacity-30 disabled:cursor-not-allowed active:scale-95"
                onClick={() => fileInputRef.current?.click()}
                disabled={!!currentUser?.isMuted}
              >
                <ImageIcon size={20} className="md:w-6 md:h-6" />
              </button>
            </div>
            
            {showEmoji && (
               <div className="absolute bottom-full left-0 mb-2 z-50 animate-slide-up shadow-2xl rounded-2xl overflow-hidden">
                 <EmojiPicker 
                   theme={Theme.DARK} 
                   onEmojiClick={onEmojiClick} 
                   lazyLoadEmojis={true}
                   width={300}
                   height={400}
                   searchDisabled={false}
                 />
               </div>
            )}

            <input 
              type="file" 
              ref={fileInputRef} 
              className="hidden" 
              accept="image/*" 
              onChange={handleFileUpload}
            />

            <form onSubmit={handleSendMessage} className="flex-1 flex gap-2">
              <input
                ref={inputRef}
                type="text"
                value={currentUser?.isMuted ? "You are muted by the host." : inputValue}
                onChange={handleInputChange}
                onPaste={handlePaste}
                placeholder={currentUser?.isMuted ? "" : "Type a message..."}
                className="w-full bg-transparent text-white placeholder-slate-500 focus:outline-none py-2.5 md:py-3 px-2 text-sm md:text-base disabled:text-slate-500 min-w-0"
                enterKeyHint="send"
                disabled={!!currentUser?.isMuted}
                autoComplete="off"
              />
              <Button 
                type="submit" 
                variant="primary" 
                className="rounded-xl px-3 md:px-4 active:scale-95 transition-transform"
                disabled={!inputValue.trim() || !!currentUser?.isMuted}
              >
                <Send size={18} className="md:w-5 md:h-5" />
              </Button>
            </form>
          </div>
        </div>

      </div>
    </div>
  );
};
