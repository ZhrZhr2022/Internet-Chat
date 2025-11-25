import { useEffect, useRef, useState, useCallback } from 'react';
import Peer, { DataConnection } from 'peerjs';
import { User, Message, ChatState, MessageType, PeerData } from '../types';
import { generateAIResponse } from '../services/gemini';

// Helper to generate random colors
const getRandomColor = () => {
  const colors = ['#f87171', '#fbbf24', '#34d399', '#60a5fa', '#a78bfa', '#f472b6'];
  return colors[Math.floor(Math.random() * colors.length)];
};

export const usePeerChat = () => {
  const [state, setState] = useState<ChatState>({
    users: [],
    messages: [],
    roomId: null,
    status: 'idle',
    error: null,
    typingUsers: [],
  });
  
  const [currentUser, setCurrentUser] = useState<User | null>(null);

  const peerRef = useRef<Peer | null>(null);
  const connectionsRef = useRef<DataConnection[]>([]);
  const hostConnectionRef = useRef<DataConnection | null>(null); // For guests

  // --- Actions ---

  const addMessage = useCallback((msg: Message) => {
    setState(prev => ({
      ...prev,
      messages: [...prev.messages, msg]
    }));
  }, []);

  const updateUsers = useCallback((users: User[]) => {
    setState(prev => ({ ...prev, users }));
  }, []);

  const handleTypingUpdate = useCallback((name: string, isTyping: boolean) => {
    setState(prev => {
      const others = prev.typingUsers.filter(n => n !== name);
      if (isTyping) {
        return { ...prev, typingUsers: [...others, name] };
      }
      return { ...prev, typingUsers: others };
    });
  }, []);

  // Broadcast data to all connected peers (Host function)
  const broadcast = useCallback((data: PeerData) => {
    connectionsRef.current.forEach(conn => {
      if (conn.open) {
        conn.send(data);
      }
    });
  }, []);

  // Send to host (Guest function)
  const sendToHost = useCallback((data: PeerData) => {
    if (hostConnectionRef.current && hostConnectionRef.current.open) {
      hostConnectionRef.current.send(data);
    }
  }, []);

  // Set typing status
  const setTyping = useCallback((isTyping: boolean) => {
    if (!currentUser) return;
    const payload: PeerData = {
      type: 'typing_status',
      payload: { name: currentUser.name, isTyping }
    };
    
    // Host doesn't need to send to host, but needs to broadcast if logic requires.
    // However, usually we just broadcast to others.
    if (currentUser.isHost) {
      broadcast(payload);
    } else {
      sendToHost(payload);
    }
  }, [currentUser, broadcast, sendToHost]);

  // Process a new message (Send & Display)
  const sendMessage = async (content: string, type: MessageType = MessageType.TEXT) => {
    if (!currentUser) return;

    const newMessage: Message = {
      id: crypto.randomUUID(),
      senderId: currentUser.id,
      senderName: currentUser.name,
      content,
      timestamp: Date.now(),
      type
    };

    // 1. Optimistic UI update
    addMessage(newMessage);

    // 2. Network transmission
    const payload: PeerData = { type: 'message', payload: newMessage };
    if (currentUser.isHost) {
      broadcast(payload);
    } else {
      sendToHost(payload);
    }

    // 3. AI Trigger (Only Host processes AI to avoid duplicates)
    if (currentUser.isHost && (content.toLowerCase().includes('@nexus') || content.toLowerCase().includes('@ai'))) {
      const aiResponseText = await generateAIResponse(content, state.messages);
      
      const aiMessage: Message = {
        id: crypto.randomUUID(),
        senderId: 'ai-bot',
        senderName: 'Nexus AI',
        content: aiResponseText,
        timestamp: Date.now(),
        type: MessageType.AI
      };

      addMessage(aiMessage);
      broadcast({ type: 'message', payload: aiMessage });
    }
  };

  // --- Connection Logic ---

  const createRoom = (username: string) => {
    const userId = crypto.randomUUID();
    const user: User = { id: userId, name: username, color: getRandomColor(), isHost: true };
    
    setCurrentUser(user);
    setState(prev => ({ ...prev, status: 'connecting', users: [user] }));

    const peer = new Peer();
    peerRef.current = peer;

    peer.on('open', (id) => {
      setState(prev => ({ ...prev, roomId: id, status: 'connected' }));
    });

    peer.on('connection', (conn) => {
      connectionsRef.current.push(conn);
      
      conn.on('data', (data: any) => {
        const pData = data as PeerData;
        handleHostData(pData, conn);
      });

      conn.on('close', () => {
        connectionsRef.current = connectionsRef.current.filter(c => c !== conn);
      });
    });

    peer.on('error', (err) => {
      console.error(err);
      setState(prev => ({ ...prev, status: 'error', error: 'Connection failed.' }));
    });
  };

  const joinRoom = (roomId: string, username: string) => {
    const userId = crypto.randomUUID();
    const user: User = { id: userId, name: username, color: getRandomColor(), isHost: false };
    
    setCurrentUser(user);
    setState(prev => ({ ...prev, status: 'connecting' }));

    const peer = new Peer();
    peerRef.current = peer;

    peer.on('open', () => {
      const conn = peer.connect(roomId);
      hostConnectionRef.current = conn;

      conn.on('open', () => {
        setState(prev => ({ ...prev, roomId, status: 'connected' }));
        conn.send({ type: 'handshake', payload: user });
      });

      conn.on('data', (data: any) => {
        handleGuestData(data as PeerData);
      });

      conn.on('error', (err) => {
        setState(prev => ({ ...prev, status: 'error', error: 'Could not connect to host.' }));
      });
      
      conn.on('close', () => {
        setState(prev => ({ ...prev, status: 'error', error: 'Host disconnected.' }));
      });
    });
    
    peer.on('error', () => {
        setState(prev => ({ ...prev, status: 'error', error: 'Failed to initialize peer.' }));
    });
  };

  // --- Data Handlers ---

  const handleHostData = (data: PeerData, senderConn: DataConnection) => {
    if (data.type === 'handshake') {
      const newUser = data.payload as User;
      setState(prev => {
        const newUsers = [...prev.users, newUser];
        const updatePayload: PeerData = { type: 'user_list_update', payload: newUsers };
        broadcast(updatePayload);
        senderConn.send({ type: 'history_sync', payload: prev.messages });
        return { ...prev, users: newUsers };
      });

      const sysMsg: Message = {
        id: crypto.randomUUID(),
        senderId: 'system',
        senderName: 'System',
        content: `${newUser.name} joined the room.`,
        timestamp: Date.now(),
        type: MessageType.SYSTEM
      };
      addMessage(sysMsg);
      broadcast({ type: 'message', payload: sysMsg });

    } else if (data.type === 'message') {
      const msg = data.payload as Message;
      addMessage(msg);
      broadcast(data); // Re-broadcast

      if (msg.content.toLowerCase().includes('@nexus') || msg.content.toLowerCase().includes('@ai')) {
         generateAIResponse(msg.content, state.messages).then(responseText => {
             const aiMessage: Message = {
                id: crypto.randomUUID(),
                senderId: 'ai-bot',
                senderName: 'Nexus AI',
                content: responseText,
                timestamp: Date.now(),
                type: MessageType.AI
              };
              addMessage(aiMessage);
              broadcast({ type: 'message', payload: aiMessage });
         });
       }
    } else if (data.type === 'typing_status') {
      const { name, isTyping } = data.payload;
      handleTypingUpdate(name, isTyping);
      // Re-broadcast so other guests see it
      broadcast(data);
    }
  };

  const handleGuestData = (data: PeerData) => {
    if (data.type === 'user_list_update') {
      updateUsers(data.payload);
    } else if (data.type === 'message') {
      addMessage(data.payload);
    } else if (data.type === 'typing_status') {
      const { name, isTyping } = data.payload;
      handleTypingUpdate(name, isTyping);
    }
  };

  // Cleanup
  useEffect(() => {
    return () => {
      peerRef.current?.destroy();
    };
  }, []);

  return {
    state,
    currentUser,
    createRoom,
    joinRoom,
    sendMessage,
    setTyping
  };
};