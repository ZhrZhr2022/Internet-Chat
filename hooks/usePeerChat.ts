import { useEffect, useRef, useState, useCallback } from 'react';
import Peer, { DataConnection } from 'peerjs';
import { User, Message, ChatState, MessageType, PeerData } from '../types';
import { generateAIResponse } from '../services/gemini';

// Helper to generate random colors
const getRandomColor = () => {
  const colors = ['#f87171', '#fbbf24', '#34d399', '#60a5fa', '#a78bfa', '#f472b6'];
  return colors[Math.floor(Math.random() * colors.length)];
};

// PeerJS Configuration with explicit STUN servers for better connectivity
const PEER_CONFIG = {
  config: {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
      { urls: 'stun:stun3.l.google.com:19302' },
      { urls: 'stun:stun4.l.google.com:19302' },
    ]
  },
  debug: 1 // Errors only
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
  const reconnectTimeoutRef = useRef<any>(null);

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

  const setupCommonPeerEvents = (peer: Peer) => {
    // Handle disconnection from signaling server (not necessarily from peers)
    peer.on('disconnected', () => {
      console.warn('Disconnected from signaling server. Attempting reconnect...');
      // PeerJS specific: IDs remain valid if we reconnect
      if (!peer.destroyed) {
        peer.reconnect();
      }
    });

    peer.on('close', () => {
      console.error('Peer connection closed completely.');
      setState(prev => ({ ...prev, status: 'error', error: 'Connection closed.' }));
    });

    peer.on('error', (err: any) => {
      console.error('Peer error:', err);
      let errorMessage = 'An error occurred.';
      
      if (err.type === 'peer-unavailable') {
        errorMessage = 'Room not found or Host is offline.';
      } else if (err.type === 'unavailable-id') {
        errorMessage = 'ID collision. Please try again.';
      } else if (err.type === 'network') {
        errorMessage = 'Network error. check your connection.';
      }

      setState(prev => ({ ...prev, status: 'error', error: errorMessage }));
    });
  };

  const createRoom = (username: string) => {
    const userId = crypto.randomUUID();
    const user: User = { id: userId, name: username, color: getRandomColor(), isHost: true };
    
    setCurrentUser(user);
    setState(prev => ({ ...prev, status: 'connecting', users: [user] }));

    const peer = new Peer(PEER_CONFIG);
    peerRef.current = peer;

    setupCommonPeerEvents(peer);

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
  };

  const joinRoom = (roomId: string, username: string) => {
    const userId = crypto.randomUUID();
    const user: User = { id: userId, name: username, color: getRandomColor(), isHost: false };
    
    setCurrentUser(user);
    setState(prev => ({ ...prev, status: 'connecting', error: null }));

    const peer = new Peer(PEER_CONFIG);
    peerRef.current = peer;

    setupCommonPeerEvents(peer);

    // Timeout to detect if connection hangs
    const connectionTimeout = setTimeout(() => {
      if (state.status !== 'connected') {
        setState(prev => ({ 
          ...prev, 
          status: 'error', 
          error: 'Connection timed out. Host might be offline.' 
        }));
      }
    }, 10000); // 10 seconds timeout

    peer.on('open', () => {
      const conn = peer.connect(roomId, {
        reliable: true
      });
      hostConnectionRef.current = conn;

      conn.on('open', () => {
        clearTimeout(connectionTimeout);
        setState(prev => ({ ...prev, roomId, status: 'connected' }));
        conn.send({ type: 'handshake', payload: user });
      });

      conn.on('data', (data: any) => {
        handleGuestData(data as PeerData);
      });

      conn.on('error', (err) => {
        clearTimeout(connectionTimeout);
        setState(prev => ({ ...prev, status: 'error', error: 'Could not connect to host.' }));
      });
      
      conn.on('close', () => {
        setState(prev => ({ ...prev, status: 'error', error: 'Host disconnected.' }));
      });
    });
  };

  // --- Data Handlers ---

  const handleHostData = (data: PeerData, senderConn: DataConnection) => {
    if (data.type === 'handshake') {
      const newUser = data.payload as User;
      setState(prev => {
        // Prevent duplicate users
        if (prev.users.find(u => u.id === newUser.id)) return prev;
        
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
      // Small delay to prevent destroying on hot-reload immediately during dev
      if (peerRef.current) {
        peerRef.current.destroy();
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
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