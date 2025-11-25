import { useEffect, useRef, useState, useCallback } from 'react';
import Peer, { DataConnection } from 'peerjs';
import { User, Message, ChatState, MessageType, PeerData } from '../types';
import { generateAIResponse } from '../services/gemini';

// Helper to generate random colors
const getRandomColor = () => {
  const colors = ['#f87171', '#fbbf24', '#34d399', '#60a5fa', '#a78bfa', '#f472b6'];
  return colors[Math.floor(Math.random() * colors.length)];
};

// PeerJS Configuration with expanded STUN servers for better NAT traversal
const PEER_CONFIG = {
  config: {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
      { urls: 'stun:stun3.l.google.com:19302' },
      { urls: 'stun:stun4.l.google.com:19302' },
      { urls: 'stun:global.stun.twilio.com:3478' },
      { urls: 'stun:stun.services.mozilla.com' }
    ],
    iceCandidatePoolSize: 10,
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
  const hostConnectionRef = useRef<DataConnection | null>(null);
  
  // Timers
  const heartbeatTimerRef = useRef<any>(null);
  const connectionTimeoutRef = useRef<any>(null);

  // --- Actions ---

  // Fix: De-duplicate messages to prevent double rendering
  const addMessage = useCallback((msg: Message) => {
    setState(prev => {
      // If message ID already exists, do not add it again
      if (prev.messages.some(m => m.id === msg.id)) {
        return prev;
      }
      return {
        ...prev,
        messages: [...prev.messages, msg]
      };
    });
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

    // Add locally first
    addMessage(newMessage);

    const payload: PeerData = { type: 'message', payload: newMessage };
    
    // Distribute
    if (currentUser.isHost) {
      broadcast(payload);
    } else {
      sendToHost(payload);
    }

    // AI Check (Only host processes AI to avoid duplicates)
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

  // Keep the signaling connection alive
  const startHeartbeat = (peer: Peer) => {
    if (heartbeatTimerRef.current) clearInterval(heartbeatTimerRef.current);
    
    heartbeatTimerRef.current = setInterval(() => {
      if (!peer || peer.destroyed) return;
      
      // If disconnected from signaling server, try to reconnect
      if (peer.disconnected && !peer.destroyed) {
        console.log('Heartbeat: Reconnecting to signaling server...');
        peer.reconnect();
      }
    }, 5000); // Check every 5 seconds
  };

  const setupCommonPeerEvents = (peer: Peer) => {
    peer.on('disconnected', () => {
      console.warn('Peer disconnected from signaling server.');
      // Don't change app state to error yet, just try to reconnect via heartbeat or immediately
      if (!peer.destroyed) {
        peer.reconnect();
      }
    });

    peer.on('close', () => {
      console.error('Peer connection closed completely.');
      setState(prev => ({ ...prev, status: 'error', error: 'Connection lost. Please reload.' }));
    });

    peer.on('error', (err: any) => {
      console.error('Peer error:', err);
      // Ignore some non-critical errors or handle them gracefully
      if (err.type === 'peer-unavailable') {
        setState(prev => ({ 
          ...prev, 
          status: 'error', 
          error: 'Room ID not found. The host might be offline or the ID is incorrect.' 
        }));
      } else if (err.type === 'network') {
        // Often temporary, don't kill the app immediately
        console.warn('Network error detected');
      } else if (err.type === 'unavailable-id') {
        setState(prev => ({ ...prev, status: 'error', error: 'ID collision. Please try again.' }));
      } else {
        // For other errors during connection phase
        if (state.status === 'connecting') {
           setState(prev => ({ ...prev, status: 'error', error: 'Connection failed. Please try again.' }));
        }
      }
    });
  };

  const createRoom = (username: string) => {
    const userId = crypto.randomUUID();
    const user: User = { id: userId, name: username, color: getRandomColor(), isHost: true };
    
    setCurrentUser(user);
    setState(prev => ({ ...prev, status: 'connecting', users: [user] }));

    // Clean up old peer if exists
    if (peerRef.current) peerRef.current.destroy();

    const peer = new Peer(PEER_CONFIG);
    peerRef.current = peer;

    setupCommonPeerEvents(peer);

    peer.on('open', (id) => {
      setState(prev => ({ ...prev, roomId: id, status: 'connected' }));
      startHeartbeat(peer);
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
      
      conn.on('error', (err) => {
        console.error('Connection error:', err);
      });
    });
  };

  const joinRoom = (roomId: string, username: string) => {
    const userId = crypto.randomUUID();
    const user: User = { id: userId, name: username, color: getRandomColor(), isHost: false };
    
    setCurrentUser(user);
    setState(prev => ({ ...prev, status: 'connecting', error: null }));

    if (peerRef.current) peerRef.current.destroy();

    const peer = new Peer(PEER_CONFIG);
    peerRef.current = peer;

    setupCommonPeerEvents(peer);

    // Extended timeout (20s)
    if (connectionTimeoutRef.current) clearTimeout(connectionTimeoutRef.current);
    connectionTimeoutRef.current = setTimeout(() => {
      if (state.status !== 'connected') {
        setState(prev => ({ 
          ...prev, 
          status: 'error', 
          error: 'Connection timed out. Host might be offline or behind a firewall.' 
        }));
      }
    }, 20000); 

    peer.on('open', () => {
      // Once we have our own ID, connect to host
      const conn = peer.connect(roomId, {
        reliable: true
      });
      hostConnectionRef.current = conn;

      conn.on('open', () => {
        if (connectionTimeoutRef.current) clearTimeout(connectionTimeoutRef.current);
        setState(prev => ({ ...prev, roomId, status: 'connected' }));
        conn.send({ type: 'handshake', payload: user });
        startHeartbeat(peer);
      });

      conn.on('data', (data: any) => {
        handleGuestData(data as PeerData);
      });

      conn.on('error', (err) => {
        console.error('Host connection error:', err);
      });
      
      conn.on('close', () => {
        setState(prev => ({ 
          ...prev, 
          status: 'error', 
          error: 'The Room Host has left. The session is closed.' 
        }));
      });
    });
  };

  // --- Data Handlers ---

  const handleHostData = (data: PeerData, senderConn: DataConnection) => {
    if (data.type === 'handshake') {
      const newUser = data.payload as User;
      setState(prev => {
        if (prev.users.find(u => u.id === newUser.id)) return prev;
        const newUsers = [...prev.users, newUser];
        // Broadcast new user list to EVERYONE
        const updatePayload: PeerData = { type: 'user_list_update', payload: newUsers };
        broadcast(updatePayload);
        // Sync history ONLY to the new user
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
      addMessage(msg); // Add locally (Host)
      broadcast(data); // Send to everyone else

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
      broadcast(data);
    }
  };

  const handleGuestData = (data: PeerData) => {
    if (data.type === 'user_list_update') {
      updateUsers(data.payload);
    } else if (data.type === 'message') {
      addMessage(data.payload);
    } else if (data.type === 'history_sync') {
      setState(prev => ({ ...prev, messages: data.payload }));
    } else if (data.type === 'typing_status') {
      const { name, isTyping } = data.payload;
      handleTypingUpdate(name, isTyping);
    }
  };

  useEffect(() => {
    return () => {
      if (peerRef.current) peerRef.current.destroy();
      if (heartbeatTimerRef.current) clearInterval(heartbeatTimerRef.current);
      if (connectionTimeoutRef.current) clearTimeout(connectionTimeoutRef.current);
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