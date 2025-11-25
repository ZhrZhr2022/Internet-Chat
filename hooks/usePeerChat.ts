
import { useEffect, useRef, useState, useCallback } from 'react';
import Peer, { DataConnection } from 'peerjs';
import { User, Message, ChatState, MessageType, PeerData } from '../types';
import { generateAIResponse } from '../services/gemini';

// Helper to generate random colors
const getRandomColor = () => {
  const colors = ['#f87171', '#fbbf24', '#34d399', '#60a5fa', '#a78bfa', '#f472b6'];
  return colors[Math.floor(Math.random() * colors.length)];
};

// Storage Key
const STORAGE_KEY = 'nexus_chat_profile';

// PeerJS Configuration
const PEER_CONFIG = {
  config: {
    iceServers: [
      { urls: 'stun:stun.qq.com:3478' },
      { urls: 'stun:stun.miwifi.com:3478' },
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:global.stun.twilio.com:3478' }
    ],
    iceCandidatePoolSize: 10,
    sdpSemantics: 'unified-plan'
  },
  pingInterval: 2000,
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
  const [isAiThinking, setIsAiThinking] = useState(false);

  const peerRef = useRef<Peer | null>(null);
  const connectionsRef = useRef<DataConnection[]>([]); // Host keeps track of all guests
  const hostConnectionRef = useRef<DataConnection | null>(null); // Guest keeps track of host

  const messageIdsRef = useRef<Set<string>>(new Set());
  // NEW: Keep track of messages in ref for sync access without closure staleness
  const messagesRef = useRef<Message[]>([]);

  const heartbeatTimerRef = useRef<any>(null);
  const connectionTimeoutRef = useRef<any>(null);
  const retryCountRef = useRef(0);

  // Sync state messages to ref
  useEffect(() => {
    messagesRef.current = state.messages;
  }, [state.messages]);

  // --- Persistence Logic ---
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const profile = JSON.parse(stored);
        // We restore ID, name, color but NOT isHost (that depends on action)
        setCurrentUser({ ...profile, isHost: false, status: 'online', isMuted: false });
      }
    } catch (e) {
      console.error("Failed to load profile", e);
    }
  }, []);

  const saveProfile = (user: User) => {
    try {
      const profile = { id: user.id, name: user.name, color: user.color };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
    } catch (e) {
      console.error("Failed to save profile", e);
    }
  };

  // --- Status & Visibility Logic ---
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!currentUser || state.status !== 'connected') return;

      const newStatus = document.hidden ? 'away' : 'online';

      const payload: PeerData = {
        type: 'status_update',
        payload: { userId: currentUser.id, status: newStatus }
      };

      if (currentUser.isHost) {
        handleStatusUpdate(currentUser.id, newStatus);
      } else {
        sendToHost(payload);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [currentUser, state.status]);

  // --- Actions ---

  const addMessage = useCallback((msg: Message) => {
    if (messageIdsRef.current.has(msg.id)) return;
    messageIdsRef.current.add(msg.id);
    setState(prev => ({ ...prev, messages: [...prev.messages, msg] }));
  }, []);

  const updateUsers = useCallback((users: User[]) => {
    setState(prev => ({ ...prev, users }));
  }, []);

  const handleTypingUpdate = useCallback((name: string, isTyping: boolean) => {
    setState(prev => {
      const others = prev.typingUsers.filter(n => n !== name);
      if (isTyping) return { ...prev, typingUsers: [...others, name] };
      return { ...prev, typingUsers: others };
    });
  }, []);

  // Admin Actions
  const kickUser = useCallback((targetUserId: string) => {
    if (!currentUser?.isHost) return;

    // Find connection
    const conn = connectionsRef.current.find(c => {
      const uId = connMapRef.current.get(c.peer);
      return uId === targetUserId;
    });

    if (conn) {
      conn.send({ type: 'kick_notification', payload: 'You have been kicked by the host.' });
      setTimeout(() => conn.close(), 500);
    }

    // Fallback
    const targetUser = state.users.find(u => u.id === targetUserId);
    if (targetUser) handleUserDisconnect(targetUserId, targetUser.name);

  }, [currentUser, state.users]);

  const toggleMuteUser = useCallback((targetUserId: string) => {
    if (!currentUser?.isHost) return;

    setState(prev => {
      const updatedUsers = prev.users.map(u =>
        u.id === targetUserId ? { ...u, isMuted: !u.isMuted } as User : u
      );
      // Broadcast new state
      broadcast({ type: 'user_list_update', payload: updatedUsers });
      return { ...prev, users: updatedUsers };
    });
  }, [currentUser]);

  const broadcast = useCallback((data: PeerData) => {
    connectionsRef.current.forEach(conn => {
      if (conn.open) conn.send(data);
    });
  }, []);

  const sendToHost = useCallback((data: PeerData) => {
    if (hostConnectionRef.current?.open) {
      hostConnectionRef.current.send(data);
    }
  }, []);

  const setTyping = useCallback((isTyping: boolean) => {
    if (!currentUser || currentUser.isMuted) return;
    const payload: PeerData = {
      type: 'typing_status',
      payload: { name: currentUser.name, isTyping }
    };
    if (currentUser.isHost) broadcast(payload);
    else sendToHost(payload);
  }, [currentUser, broadcast, sendToHost]);

  const sendMessage = async (content: string, type: MessageType = MessageType.TEXT) => {
    if (!currentUser) return;
    if (currentUser.isMuted) {
      alert("You have been muted by the host.");
      return;
    }

    const newMessage: Message = {
      id: crypto.randomUUID(),
      senderId: currentUser.id,
      senderName: currentUser.name,
      content,
      timestamp: Date.now(),
      type
    };

    addMessage(newMessage);
    const payload: PeerData = { type: 'message', payload: newMessage };

    if (currentUser.isHost) broadcast(payload);
    else sendToHost(payload);

    if (currentUser.isHost && type === MessageType.TEXT && (content.toLowerCase().includes('@nexus') || content.toLowerCase().includes('@ai'))) {
      setIsAiThinking(true);
      const currentMessages = [...messagesRef.current, newMessage]; // Use Ref for latest
      try {
        const aiResponseText = await generateAIResponse(content, currentMessages);
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
      } finally {
        setIsAiThinking(false);
      }
    }
  };

  // --- Connection Logic ---

  const startHeartbeat = (peer: Peer) => {
    if (heartbeatTimerRef.current) clearInterval(heartbeatTimerRef.current);
    heartbeatTimerRef.current = setInterval(() => {
      if (!peer || peer.destroyed) return;
      if (peer.disconnected && !peer.destroyed) peer.reconnect();
    }, 2000);
  };

  const createRoom = (username: string) => {
    const userId = currentUser?.id || crypto.randomUUID();
    const user: User = {
      id: userId,
      name: username,
      color: currentUser?.color || getRandomColor(),
      isHost: true,
      status: 'online',
      isMuted: false
    };
    const aiUser: User = { id: 'ai-bot', name: 'Nexus AI', color: '#10b981', isHost: false, status: 'online' };

    setCurrentUser(user);
    saveProfile(user);
    messageIdsRef.current.clear();
    messagesRef.current = [];
    setState(prev => ({ ...prev, status: 'connecting', users: [user, aiUser], messages: [] }));

    if (peerRef.current) peerRef.current.destroy();
    const peer = new Peer(PEER_CONFIG);
    peerRef.current = peer;

    peer.on('open', (id) => {
      setState(prev => ({ ...prev, roomId: id, status: 'connected' }));
      startHeartbeat(peer);
    });

    peer.on('connection', (conn) => {
      connectionsRef.current.push(conn);
      conn.on('data', (data: any) => handleHostData(data as PeerData, conn));
      conn.on('close', () => { /* Handled via map */ });
      conn.on('error', (err) => console.error("Connection error:", err));
    });

    peer.on('error', (err: any) => {
      console.error("Peer Error", err);
      setState(prev => ({ ...prev, status: 'error', error: `Host Error: ${err.type}` }));
    });
  };

  const joinRoom = (roomId: string, username: string) => {
    const userId = currentUser?.id || crypto.randomUUID();
    const user: User = {
      id: userId,
      name: username,
      color: currentUser?.color || getRandomColor(),
      isHost: false,
      status: 'online',
      isMuted: false
    };

    setCurrentUser(user);
    saveProfile(user);
    messageIdsRef.current.clear();
    messagesRef.current = [];
    setState(prev => ({ ...prev, status: 'connecting', error: null, messages: [] }));

    if (peerRef.current) peerRef.current.destroy();
    const peer = new Peer(PEER_CONFIG);
    peerRef.current = peer;

    // Retry Logic
    const attemptConnection = () => {
      const conn = peer.connect(roomId, {
        reliable: true,
        serialization: 'json',
        metadata: { userId, username }
      });
      hostConnectionRef.current = conn;

      conn.on('open', () => {
        if (connectionTimeoutRef.current) clearTimeout(connectionTimeoutRef.current);
        retryCountRef.current = 0;
        setState(prev => ({ ...prev, roomId, status: 'connected' }));
        conn.send({ type: 'handshake', payload: user });
        startHeartbeat(peer);
      });

      conn.on('data', (data: any) => handleGuestData(data as PeerData));

      conn.on('close', () => {
        if (state.status !== 'kicked') {
          setState(prev => ({ ...prev, status: 'error', error: 'Host disconnected.' }));
        }
      });

      conn.on('error', (e) => console.error("Conn Error", e));
    };

    peer.on('open', attemptConnection);

    peer.on('error', (err: any) => {
      console.error('Peer error:', err);
      if (err.type === 'peer-unavailable' && retryCountRef.current < 3) {
        retryCountRef.current++;
        console.log(`Retrying connection... Attempt ${retryCountRef.current}`);
        setTimeout(attemptConnection, 2000);
      } else {
        setState(prev => ({
          ...prev,
          status: 'error',
          error: err.type === 'peer-unavailable'
            ? 'Room ID not found. Host might be offline.'
            : `Connection Error: ${err.type}`
        }));
      }
    });

    connectionTimeoutRef.current = setTimeout(() => {
      if (state.status !== 'connected') {
        setState(prev => ({ ...prev, status: 'error', error: 'Connection timed out.' }));
      }
    }, 45000);
  };

  // --- Data Handlers ---

  const connMapRef = useRef<Map<string, string>>(new Map());

  const handleStatusUpdate = (userId: string, status: 'online' | 'away') => {
    setState(prev => {
      const newUsers = prev.users.map(u => u.id === userId ? { ...u, status } as User : u);
      broadcast({ type: 'user_list_update', payload: newUsers });
      return { ...prev, users: newUsers };
    });
  };

  const handleHostData = async (data: PeerData, senderConn: DataConnection) => {
    if (data.type === 'handshake') {
      const newUser = data.payload as User;
      connMapRef.current.set(senderConn.peer, newUser.id);

      senderConn.on('close', () => handleUserDisconnect(newUser.id, newUser.name));

      setState(prev => {
        const existingIndex = prev.users.findIndex(u => u.id === newUser.id);
        let newUsers: User[];
        if (existingIndex >= 0) {
          newUsers = [...prev.users];
          newUsers[existingIndex] = { ...newUser, status: 'online' } as User;
        } else {
          newUsers = [...prev.users, { ...newUser, status: 'online' } as User];
        }

        broadcast({ type: 'user_list_update', payload: newUsers });

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

      // Update local state
      addMessage(sysMsg);
      // Broadcast to others
      broadcast({ type: 'message', payload: sysMsg });

      // CRITICAL FIX: Chunk history to prevent P2P data choke
      // Split history into chunks of 20 messages
      const historyToSync = [...messagesRef.current, sysMsg];
      const CHUNK_SIZE = 20;

      setTimeout(() => {
        if (senderConn.open) {
          for (let i = 0; i < historyToSync.length; i += CHUNK_SIZE) {
            const chunk = historyToSync.slice(i, i + CHUNK_SIZE);
            senderConn.send({ type: 'history_sync', payload: chunk });
          }
        }
      }, 800);

    } else if (data.type === 'message') {
      const msg = data.payload as Message;
      const sender = state.users.find(u => u.id === msg.senderId);
      if (sender?.isMuted) return;

      addMessage(msg);
      // Important: Broadcast to everyone including the sender (sender ignores duplicate ID)
      broadcast(data);

      if (msg.type === MessageType.TEXT && (msg.content.toLowerCase().includes('@nexus') || msg.content.toLowerCase().includes('@ai'))) {
        setIsAiThinking(true);
        const currentMessages = [...messagesRef.current, msg];
        try {
          const responseText = await generateAIResponse(msg.content, currentMessages);
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
        } finally {
          setIsAiThinking(false);
        }
      }
    } else if (data.type === 'typing_status') {
      const { name, isTyping } = data.payload;
      handleTypingUpdate(name, isTyping);
      broadcast(data);
    } else if (data.type === 'status_update') {
      const { userId, status } = data.payload;
      handleStatusUpdate(userId, status);
    }
  };

  const handleUserDisconnect = (userId: string, userName: string) => {
    setState(prev => {
      const newUsers = prev.users.filter(u => u.id !== userId);

      // Cleanup closed connections
      connectionsRef.current = connectionsRef.current.filter(c => c.open);

      const remainingConns = connectionsRef.current;
      const listUpdate: PeerData = { type: 'user_list_update', payload: newUsers };

      remainingConns.forEach(conn => conn.send(listUpdate));

      return { ...prev, users: newUsers };
    });

    const sysMsg: Message = {
      id: crypto.randomUUID(),
      senderId: 'system',
      senderName: 'System',
      content: `${userName} left the room.`,
      timestamp: Date.now(),
      type: MessageType.SYSTEM
    };
    addMessage(sysMsg);
    broadcast({ type: 'message', payload: sysMsg });
  };

  const handleGuestData = (data: PeerData) => {
    if (data.type === 'user_list_update') {
      updateUsers(data.payload);
      const myUser = (data.payload as User[]).find(u => u.id === currentUser?.id);
      if (myUser && currentUser) {
        if (myUser.isMuted !== currentUser.isMuted) {
          setCurrentUser(prev => prev ? ({ ...prev, isMuted: myUser.isMuted }) : null);
        }
      }

    } else if (data.type === 'message') {
      addMessage(data.payload);
    } else if (data.type === 'history_sync') {
      const history = data.payload as Message[];
      // Verify history is array before processing
      if (!Array.isArray(history)) return;

      const historyIds = new Set(history.map(m => m.id));

      setState(prev => {
        // Merge logic: Keep messages that we received locally which are NOT in history yet
        // This protects against the case where a "Joined" message arrives before history sync
        const localMessages = prev.messages.filter(m => !historyIds.has(m.id));
        const merged = [...history, ...localMessages].sort((a, b) => a.timestamp - b.timestamp);

        // Update ID tracker
        merged.forEach(m => messageIdsRef.current.add(m.id));
        messagesRef.current = merged;

        return { ...prev, messages: merged };
      });

    } else if (data.type === 'typing_status') {
      const { name, isTyping } = data.payload;
      handleTypingUpdate(name, isTyping);
    } else if (data.type === 'kick_notification') {
      setState(prev => ({ ...prev, status: 'kicked', error: data.payload }));
      if (hostConnectionRef.current) hostConnectionRef.current.close();
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
    isAiThinking,
    createRoom,
    joinRoom,
    sendMessage,
    setTyping,
    kickUser,
    toggleMuteUser
  };
};
