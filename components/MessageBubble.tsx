import React from 'react';
import ReactMarkdown from 'react-markdown';
import { Message, MessageType } from '../types';
import { Bot } from 'lucide-react';

interface MessageBubbleProps {
  message: Message;
  isSelf: boolean;
  isMentioned?: boolean;
  onImageClick?: (src: string) => void;
}

export const MessageBubble: React.FC<MessageBubbleProps> = ({ message, isSelf, isMentioned, onImageClick }) => {
  const timeString = new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  if (message.type === MessageType.SYSTEM) {
    return (
      <div className="flex justify-center my-4 animate-fade-in">
        <span className="px-3 py-1 rounded-full bg-white/5 text-xs text-slate-400 border border-white/5 backdrop-blur-sm">
          {message.content}
        </span>
      </div>
    );
  }

  // Changed items-end to items-start for top alignment of avatars
  return (
    <div className={`flex w-full mb-4 animate-slide-up ${isSelf ? 'justify-end' : 'justify-start'}`}>
      <div className={`flex max-w-[85%] md:max-w-[70%] ${isSelf ? 'flex-row-reverse' : 'flex-row'} items-start gap-2`}>
        
        {/* Avatar */}
        <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-1 ${
          message.type === MessageType.AI ? 'bg-gradient-to-br from-emerald-400 to-cyan-500' : 
          isSelf ? 'bg-gradient-to-br from-indigo-500 to-purple-600' : 'bg-slate-700'
        }`}>
          {message.type === MessageType.AI ? <Bot size={16} className="text-white" /> : 
           <div className="text-xs font-bold text-white">
             {message.senderName.substring(0, 2).toUpperCase()}
           </div>
          }
        </div>

        {/* Bubble */}
        <div className={`flex flex-col ${isSelf ? 'items-end' : 'items-start'}`}>
          <div className="flex items-center gap-2 mb-1 px-1">
            <span className="text-xs text-slate-300 font-medium">{message.senderName}</span>
            <span className="text-[10px] text-slate-500">{timeString}</span>
          </div>

          <div className={`px-4 py-2.5 rounded-2xl shadow-sm relative transition-all duration-300 ${
            isMentioned ? 'ring-2 ring-yellow-400/70 shadow-[0_0_15px_rgba(250,204,21,0.2)]' : ''
          } ${
            isSelf 
              ? 'bg-indigo-600 text-white rounded-tr-none' 
              : message.type === MessageType.AI 
                ? 'bg-slate-800/90 border border-emerald-500/30 text-emerald-50 rounded-tl-none'
                : isMentioned 
                  ? 'bg-slate-800 text-slate-100 rounded-tl-none border border-yellow-500/30 bg-yellow-500/5' 
                  : 'bg-slate-800 text-slate-100 rounded-tl-none'
          }`}>
            {message.type === MessageType.IMAGE ? (
              <img 
                src={message.content} 
                alt="Shared attachment" 
                className="max-w-full rounded-lg max-h-60 object-cover cursor-pointer hover:opacity-90 transition-opacity"
                onClick={() => onImageClick && onImageClick(message.content)}
              />
            ) : (
              <div className="prose prose-invert prose-sm max-w-none break-words leading-relaxed">
                <ReactMarkdown>{message.content}</ReactMarkdown>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};