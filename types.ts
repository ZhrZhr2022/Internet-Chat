export interface User {
  id: string;
  name: string;
  color: string;
  isHost: boolean;
  avatar?: string;
}

export enum MessageType {
  TEXT = 'TEXT',
  IMAGE = 'IMAGE',
  SYSTEM = 'SYSTEM',
  AI = 'AI'
}

export interface Message {
  id: string;
  senderId: string;
  senderName: string;
  content: string; // Text content or Base64 image
  timestamp: number;
  type: MessageType;
}

export interface ChatState {
  users: User[];
  messages: Message[];
  roomId: string | null;
  status: 'idle' | 'connecting' | 'connected' | 'error';
  error: string | null;
  typingUsers: string[]; // List of names currently typing
}

export interface PeerData {
  type: 'handshake' | 'message' | 'user_list_update' | 'typing_status' | 'history_sync';
  payload: any;
}