import { useEffect, useRef, useState, useCallback } from 'react';
import Peer, { DataConnection } from 'peerjs';
import { User, Message, ChatState, MessageType, PeerData } from '../types';
import { generateAIResponse } from '../services/gemini';

// Helper to generate random colors
const getRandomColor = () => {
  const colors = ['#f87171', '#fbbf24', '#34d399', '#60a5fa', '#a78bfa', '#f472b6'];
  return colors[Math.floor(Math.random() * colors.length)];
};

// PeerJS Configuration optimized for China/Restricted Networks
const PEER_CONFIG = {
  config: {
    iceServers: [
      // Tencent (QQ) - Highly reliable in China
      { urls: 'stun:stun.qq.com:3478' },
      // Xiaomi - Good backup for China
      { urls: 'stun:stun.miwifi.com:3478' },
      // Twilio - Good global backup
      { urls: 'stun:global.stun.twilio.com:3478' }
    ],
    iceCandidatePoolSize: 10,
    sdpSemantics: 'unified-plan'
  },
  // Keep alive pings to prevent NAT timeouts (common in 4G/5G)
  pingInterval: 5000, 
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
  const connectionsRef = useRef<DataConnection[]>([]); // Host keeps track of all guests
  const hostConnectionRef = useRef<DataConnection | null>(null); // Guest keeps track of host
  
  // SYNC References to prevent race conditions (Fixes double message bug)
  const messageIdsRef = useRef<Set<string>>(new Set());
  
  // Timers
  const heartbeatTimerRef = useRef<any>(null);
  const connectionTimeoutRef = useRef<any>(null);

  // --- Actions ---

  // Synchronously check and add message to avoid duplicates
  const addMessage = useCallback((msg: Message) => {
    // If we have already processed this ID, ignore it completely
    if (messageIdsRef.current.has(msg.id)) {
      return;
    }
    
    // Mark as seen
    messageIdsRef.current.add(msg.id);

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
      if (peer.disconnected && !peer.destroyed) {
        console.log('Heartbeat: Reconnecting to signaling server...');
        peer.reconnect();
      }
    }, 5000); 
  };

  const setupCommonPeerEvents = (peer: Peer) => {
    peer.on('disconnected', () => {
      // Don't auto-reconnect immediately here to avoid loops, let heartbeat handle it
      // unless it was a temporary network blip
    });

    peer.on('close', () => {
      setState(prev => ({ ...prev, status: 'error', error: 'Connection lost. Please reload.' }));
    });

    peer.on('error', (err: any) => {
      console.error('Peer error:', err);
      if (err.type === 'peer-unavailable') {
        setState(prev => ({ 
          ...prev, 
          status: 'error', 
          error: 'Room ID not found. The host might be offline or check the ID.' 
        }));
      } else if (err.type === 'unavailable-id') {
        setState(prev => ({ ...prev, status: 'error', error: 'ID collision. Try again.' }));
      } else if (err.type === 'network') {
        // Suppress network errors during reconnection attempts
        console.warn('Network error detected, waiting for heartbeat reconnection');
      }
    });
  };

  const createRoom = (username: string) => {
    const userId = crypto.randomUUID();
    const user: User = { id: userId, name: username, color: getRandomColor(), isHost: true };
    // Create Default AI User
    const aiUser: User = { id: 'ai-bot', name: 'Nexus AI', color: '#10b981', isHost: false };
    
    setCurrentUser(user);
    // Important: Reset message IDs for new session
    messageIdsRef.current.clear();
    // Add both myself and the AI to the user list
    setState(prev => ({ ...prev, status: 'connecting', users: [user, aiUser], messages: [] }));

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
          // Handled via handleUserDisconnect logic when possible, 
          // or just generic cleanup if we can identify connection.
      });
      
      conn.on('error', (err) => console.error("Connection error:", err));
    });
  };

  const joinRoom = (roomId: string, username: string) => {
    const userId = crypto.randomUUID();
    const user: User = { id: userId, name: username, color: getRandomColor(), isHost: false };
    
    setCurrentUser(user);
    messageIdsRef.current.clear();
    setState(prev => ({ ...prev, status: 'connecting', error: null, messages: [] }));

    if (peerRef.current) peerRef.current.destroy();

    const peer = new Peer(PEER_CONFIG);
    peerRef.current = peer;

    setupCommonPeerEvents(peer);

    // Extended Timeout check for slower networks (China)
    connectionTimeoutRef.current = setTimeout(() => {
      if (state.status !== 'connected') {
        setState(prev => ({ 
          ...prev, 
          status: 'error', 
          error: 'Connection timed out. Host might be offline or blocked by firewall.' 
        }));
      }
    }, 45000); // Increased to 45s

    peer.on('open', () => {
      const conn = peer.connect(roomId, {
        reliable: true,
        serialization: 'json', // Fix for connectivity issues
        metadata: { userId, username } // Pass metadata for disconnection tracking
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

      conn.on('close', () => {
        setState(prev => ({ 
          ...prev, 
          status: 'error', 
          error: 'Host disconnected. Room closed.' 
        }));
      });
      
      conn.on('error', (e) => console.error("Conn Error", e));
    });
  };

  // --- Data Handlers ---

  // Map to track connection -> UserID for disconnection handling
  const connMapRef = useRef<Map<string, string>>(new Map());

  const handleHostData = (data: PeerData, senderConn: DataConnection) => {
    if (data.type === 'handshake') {
      const newUser = data.payload as User;
      
      // Track connection
      connMapRef.current.set(senderConn.peer, newUser.id);
      
      // Set up Close handler SPECIFIC to this user now that we know who they are
      senderConn.on('close', () => {
         handleUserDisconnect(newUser.id, newUser.name);
      });

      setState(prev => {
        // Prevent duplicate user entries
        if (prev.users.find(u => u.id === newUser.id)) return prev;
        
        const newUsers = [...prev.users, newUser];
        // Broadcast new user list
        broadcast({ type: 'user_list_update', payload: newUsers });
        // Sync history to NEW user only
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
      broadcast(data); // Relay to others

      // DeepSeek AI Check
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
      broadcast(data); // Relay
    }
  };

  const handleUserDisconnect = (userId: string, userName: string) => {
    setState(prev => {
       const newUsers = prev.users.filter(u => u.id !== userId);
       return { ...prev, users: newUsers };
    });

    const remainingConns = connectionsRef.current.filter(c => c.open);
    
    // Notify others
    const sysMsg: Message = {
        id: crypto.randomUUID(),
        senderId: 'system',
        senderName: 'System',
        content: `${userName} left the room.`,
        timestamp: Date.now(),
        type: MessageType.SYSTEM
    };
    addMessage(sysMsg);
    
    const remainingUsers = state.users.filter(u => u.id !== userId);
    const listUpdate: PeerData = { type: 'user_list_update', payload: remainingUsers };
    const msgUpdate: PeerData = { type: 'message', payload: sysMsg };

    remainingConns.forEach(conn => {
        conn.send(listUpdate);
        conn.send(msgUpdate);
    });
  };

  const handleGuestData = (data: PeerData) => {
    if (data.type === 'user_list_update') {
      updateUsers(data.payload);
    } else if (data.type === 'message') {
      addMessage(data.payload);
    } else if (data.type === 'history_sync') {
      // Bulk add history, checking duplicates
      const history = data.payload as Message[];
      history.forEach(msg => {
          if(!messageIdsRef.current.has(msg.id)) {
              messageIdsRef.current.add(msg.id);
          }
      });
      setState(prev => ({ ...prev, messages: history }));
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