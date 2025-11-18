import { useCallback, useEffect, useRef, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';

import { supabase, type SupabaseClient } from '@/lib/supabaseClient';

export interface MatchChatAuthor {
  id: string | null;
  name: string;
  avatarUrl?: string | null;
}

export interface MatchChatMessage {
  id: string;
  matchId: string;
  text: string;
  author: MatchChatAuthor;
  createdAt: number;
  pending?: boolean;
}

export interface MatchChatDraft {
  text: string;
  author: MatchChatAuthor;
}

export interface MatchTypingPayload {
  author: MatchChatAuthor;
  isTyping: boolean;
}

export interface MatchChatReaction {
  messageId: string;
  author: MatchChatAuthor;
  emoji: string;
  removed?: boolean;
}

export interface MatchChatAdapter {
  loadHistory(matchId: string): Promise<MatchChatMessage[]>;
  persistMessage(matchId: string, draft: MatchChatDraft): Promise<MatchChatMessage>;
  broadcastReaction?(matchId: string, reaction: MatchChatReaction): Promise<void>;
  subscribe?(matchId: string, callback: (messages: MatchChatMessage[]) => void): () => void;
  subscribeReactions?(matchId: string, callback: (reactions: MatchChatReaction[]) => void): () => void;
  subscribeTyping?(matchId: string, callback: (authors: MatchChatAuthor[]) => void): () => void;
  broadcastTyping?(matchId: string, payload: MatchTypingPayload): Promise<void>;
  clear?(matchId: string): Promise<void>;
}

export interface UseMatchChatOptions {
  matchId: string | null | undefined;
  author: MatchChatAuthor | null;
  adapter?: MatchChatAdapter | null;
}

export interface UseMatchChatReturn {
  messages: MatchChatMessage[];
  reactions: MatchChatReaction[];
  status: 'idle' | 'loading' | 'ready';
  sendMessage: (text: string) => Promise<void>;
  sendReaction: (messageId: string, emoji: string, removed?: boolean) => Promise<void>;
  canSend: boolean;
  clearHistory: () => Promise<void>;
  typingUsers: MatchChatAuthor[];
  notifyTyping: (isTyping: boolean) => Promise<void>;
}

const STORAGE_KEY_PREFIX = 'santorini:matchChat:';
const MAX_SAVED_MESSAGES = 200;
const CHAT_CHANNEL_PREFIX = 'match-chat-';
const CHAT_EVENT_NAME = 'chat-message';
const CHAT_TYPING_EVENT_NAME = 'chat-typing';
const CHAT_REACTION_EVENT_NAME = 'chat-reaction';

const sortMessages = (messages: MatchChatMessage[]): MatchChatMessage[] =>
  [...messages].sort((a, b) => {
    if (a.createdAt === b.createdAt) {
      return a.id.localeCompare(b.id);
    }
    return a.createdAt - b.createdAt;
  });

const clampMessages = (messages: MatchChatMessage[]): MatchChatMessage[] =>
  sortMessages(messages).slice(-MAX_SAVED_MESSAGES);

const isLocalMatchId = (matchId: string): boolean => matchId.startsWith('local:');

const generateMessageId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2)}`;
};

const getStorage = (): Storage | null => {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    return window.localStorage;
  } catch (error) {
    console.warn('useMatchChat: localStorage unavailable', error);
    return null;
  }
};

const readFromStorage = (matchId: string): MatchChatMessage[] => {
  const storage = getStorage();
  if (!storage) {
    return [];
  }
  const raw = storage.getItem(`${STORAGE_KEY_PREFIX}${matchId}`);
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as MatchChatMessage[];
    if (Array.isArray(parsed)) {
      return parsed.map((message) => ({
        ...message,
        createdAt: Number(message.createdAt) || Date.now(),
      }));
    }
  } catch (error) {
    console.warn('useMatchChat: failed to parse chat history', error);
  }
  return [];
};

const writeToStorage = (matchId: string, messages: MatchChatMessage[]) => {
  const storage = getStorage();
  if (!storage) {
    return;
  }
  try {
    storage.setItem(`${STORAGE_KEY_PREFIX}${matchId}`, JSON.stringify(messages.slice(-MAX_SAVED_MESSAGES)));
  } catch (error) {
    console.warn('useMatchChat: failed to persist chat history', error);
  }
};

const upsertMessage = (messages: MatchChatMessage[], incoming: MatchChatMessage): MatchChatMessage[] => {
  const index = messages.findIndex((message) => message.id === incoming.id);
  if (index >= 0) {
    const next = [...messages];
    next[index] = incoming;
    return clampMessages(next);
  }
  return clampMessages([...messages, incoming]);
};

interface BroadcastMessagePayload {
  id: string;
  match_id: string;
  text: string;
  created_at: number;
  author: {
    id: string | null;
    name: string;
    avatar_url: string | null;
  };
}

const serializeBroadcastMessage = (message: MatchChatMessage): BroadcastMessagePayload => ({
  id: message.id,
  match_id: message.matchId,
  text: message.text,
  created_at: message.createdAt,
  author: {
    id: message.author.id,
    name: message.author.name,
    avatar_url: message.author.avatarUrl ?? null,
  },
});

const deserializeBroadcastMessage = (payload: unknown): MatchChatMessage | null => {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  const raw = payload as Record<string, unknown>;
  const id = typeof raw.id === 'string' ? raw.id : null;
  const matchId = typeof raw.match_id === 'string' ? raw.match_id : null;
  const text = typeof raw.text === 'string' ? raw.text : null;
  if (!id || !matchId || !text) {
    return null;
  }
  const createdAtValue = raw.created_at;
  const createdAt =
    typeof createdAtValue === 'number' && Number.isFinite(createdAtValue) ? createdAtValue : Date.now();
  const authorPayload = (raw.author ?? {}) as Record<string, unknown>;
  const author: MatchChatAuthor = {
    id: typeof authorPayload.id === 'string' ? authorPayload.id : null,
    name: typeof authorPayload.name === 'string' ? authorPayload.name : 'Player',
    avatarUrl:
      authorPayload.avatar_url == null || typeof authorPayload.avatar_url === 'string'
        ? ((authorPayload.avatar_url as string | null | undefined) ?? null)
        : null,
  };
  return {
    id,
    matchId,
    text,
    author,
    createdAt,
  };
};

interface MatchTypingEventPayload {
  author: MatchChatAuthor;
  isTyping: boolean;
}

const deserializeTypingPayload = (payload: unknown): MatchTypingEventPayload | null => {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  const raw = payload as Record<string, unknown>;
  const isTyping = Boolean(raw.isTyping);
  const authorRaw = (raw.author ?? {}) as Record<string, unknown>;
  const author: MatchChatAuthor = {
    id: typeof authorRaw.id === 'string' ? authorRaw.id : null,
    name: typeof authorRaw.name === 'string' ? authorRaw.name : 'Player',
    avatarUrl:
      authorRaw.avatar_url == null || typeof authorRaw.avatar_url === 'string'
        ? ((authorRaw.avatar_url as string | null | undefined) ?? null)
        : null,
  };
  return {
    author,
    isTyping,
  };
};

const getAuthorKey = (author: MatchChatAuthor): string => author.id ?? author.name ?? 'unknown';

const localStorageAdapter: MatchChatAdapter = {
  async loadHistory(matchId) {
    return sortMessages(readFromStorage(matchId));
  },
  async persistMessage(matchId, draft) {
    const message: MatchChatMessage = {
      id: generateMessageId(),
      matchId,
      text: draft.text,
      author: draft.author,
      createdAt: Date.now(),
    };
    const history = readFromStorage(matchId);
    writeToStorage(matchId, [...history, message]);
    return message;
  },
  subscribe(matchId, callback) {
    if (typeof window === 'undefined') {
      return () => undefined;
    }
    const handler = (event: StorageEvent) => {
      if (event.key === `${STORAGE_KEY_PREFIX}${matchId}`) {
        callback(sortMessages(readFromStorage(matchId)));
      }
    };
    window.addEventListener('storage', handler);
    return () => {
      window.removeEventListener('storage', handler);
    };
  },
  async clear(matchId) {
    const storage = getStorage();
    storage?.removeItem(`${STORAGE_KEY_PREFIX}${matchId}`);
  },
};

interface ChatChannelEntry {
  matchId: string;
  channel: RealtimeChannel;
  listeners: Set<(messages: MatchChatMessage[]) => void>;
  typingListeners: Set<(authors: MatchChatAuthor[]) => void>;
  reactionListeners: Set<(reactions: MatchChatReaction[]) => void>;
  messages: MatchChatMessage[];
  typingState: Map<string, MatchChatAuthor>;
}

const deserializeReactionPayload = (payload: unknown): MatchChatReaction | null => {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  const raw = payload as Record<string, unknown>;
  const messageId = typeof raw.messageId === 'string' ? raw.messageId : null;
  const emoji = typeof raw.emoji === 'string' ? raw.emoji : null;
  if (!messageId || !emoji) {
    return null;
  }
  const authorPayload = (raw.author ?? {}) as Record<string, unknown>;
  const author: MatchChatAuthor = {
    id: typeof authorPayload.id === 'string' ? authorPayload.id : null,
    name: typeof authorPayload.name === 'string' ? authorPayload.name : 'Player',
    avatarUrl:
      authorPayload.avatar_url == null || typeof authorPayload.avatar_url === 'string'
        ? ((authorPayload.avatar_url as string | null | undefined) ?? null)
        : null,
  };
  const removed = raw.removed === true;
  return {
    messageId,
    author,
    emoji,
    removed,
  };
};

const createRealtimeMatchChatAdapter = (client: SupabaseClient): MatchChatAdapter => {
  const channelEntries = new Map<string, ChatChannelEntry>();

  const ensureChannel = (matchId: string): ChatChannelEntry | null => {
    if (!matchId || isLocalMatchId(matchId)) {
      return null;
    }
    let entry = channelEntries.get(matchId);
    if (entry) {
      return entry;
    }
    const channel = client.channel(`${CHAT_CHANNEL_PREFIX}${matchId}`, {
      config: { broadcast: { self: true } },
    });
    entry = {
      matchId,
      channel,
      listeners: new Set(),
      typingListeners: new Set(),
      reactionListeners: new Set(),
      messages: sortMessages(readFromStorage(matchId)),
      typingState: new Map(),
    };
    channel
      .on('broadcast', { event: CHAT_EVENT_NAME }, (payload: { payload: unknown } | null) => {
        const message = deserializeBroadcastMessage(payload?.payload);
        if (!message || message.matchId !== matchId) {
          return;
        }
        entry!.messages = upsertMessage(entry!.messages, message);
        writeToStorage(matchId, entry!.messages);
        entry!.listeners.forEach((listener) => {
          listener(entry!.messages);
        });
      })
      .on('broadcast', { event: CHAT_TYPING_EVENT_NAME }, (payload: { payload: unknown } | null) => {
        if (!entry) {
          return;
        }
        const typingPayload = deserializeTypingPayload(payload?.payload);
        if (!typingPayload) {
          return;
        }
        const key = getAuthorKey(typingPayload.author);
        if (typingPayload.isTyping) {
          entry.typingState.set(key, typingPayload.author);
        } else {
          entry.typingState.delete(key);
        }
        const typingAuthors = Array.from(entry.typingState.values());
        entry.typingListeners.forEach((listener) => listener(typingAuthors));
      })
      .on('broadcast', { event: CHAT_REACTION_EVENT_NAME }, (payload: { payload: unknown } | null) => {
        if (!entry) {
          return;
        }
        const reaction = deserializeReactionPayload(payload?.payload);
        if (!reaction) {
          return;
        }
        // Reactions are ephemeral and not persisted, just broadcasted.
        // The UI will be responsible for aggregating them.
        entry.reactionListeners.forEach((listener) => listener([reaction]));
      })
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.warn('useMatchChat: chat channel issue', { matchId, status });
        }
      });
    channelEntries.set(matchId, entry);
    return entry;
  };

  const cleanupChannel = (matchId: string) => {
    const entry = channelEntries.get(matchId);
    if (!entry || entry.listeners.size > 0 || entry.typingListeners.size > 0 || entry.reactionListeners.size > 0) {
      return;
    }
    try {
      void entry.channel.unsubscribe();
    } catch (error) {
      console.warn('useMatchChat: failed to unsubscribe chat channel', { matchId, error });
    }
    void client.removeChannel(entry.channel);
    channelEntries.delete(matchId);
  };

  return {
    async loadHistory(matchId) {
      return localStorageAdapter.loadHistory(matchId);
    },
    async persistMessage(matchId, draft) {
      const saved = await localStorageAdapter.persistMessage(matchId, draft);
      const entry = ensureChannel(matchId);
      if (entry) {
        try {
          await entry.channel.send({
            type: 'broadcast',
            event: CHAT_EVENT_NAME,
            payload: serializeBroadcastMessage(saved),
          });
        } catch (error) {
          console.warn('useMatchChat: failed to broadcast chat message', error);
        }
      }
      return saved;
    },
    async broadcastReaction(matchId, reaction) {
      const entry = ensureChannel(matchId);
      if (!entry) {
        return;
      }
      try {
        await entry.channel.send({
          type: 'broadcast',
          event: CHAT_REACTION_EVENT_NAME,
          payload: reaction,
        });
      } catch (error) {
        console.warn('useMatchChat: failed to broadcast reaction', error);
      }
    },
    subscribe(matchId, callback) {
      const entry = ensureChannel(matchId);
      if (!entry) {
        const fallbackUnsubscribe = localStorageAdapter.subscribe?.(matchId, callback);
        return fallbackUnsubscribe ?? (() => {});
      }
      const storageListener = (next: MatchChatMessage[]) => {
        entry.messages = clampMessages(next);
        callback(entry.messages);
      };
      const storageUnsubscribe = localStorageAdapter.subscribe?.(matchId, storageListener);
      entry.listeners.add(callback);
      callback(entry.messages);
      return () => {
        storageUnsubscribe?.();
       entry.listeners.delete(callback);
        cleanupChannel(matchId);
      };
    },
    subscribeReactions(matchId, callback) {
      const entry = ensureChannel(matchId);
      if (!entry) {
        return () => {};
      }
      entry.reactionListeners.add(callback);
      return () => {
        entry.reactionListeners.delete(callback);
        cleanupChannel(matchId);
      };
    },
    subscribeTyping(matchId, callback) {
      const entry = ensureChannel(matchId);
      if (!entry) {
        return () => {};
      }
      entry.typingListeners.add(callback);
      callback(Array.from(entry.typingState.values()));
      return () => {
        entry.typingListeners.delete(callback);
        cleanupChannel(matchId);
      };
    },
    async broadcastTyping(matchId, payload) {
      const entry = ensureChannel(matchId);
      if (!entry) {
        return;
      }
      try {
        await entry.channel.send({
          type: 'broadcast',
          event: CHAT_TYPING_EVENT_NAME,
          payload,
        });
      } catch (error) {
        console.warn('useMatchChat: failed to broadcast typing status', error);
      }
    },
    async clear(matchId) {
      await localStorageAdapter.clear?.(matchId);
      const entry = channelEntries.get(matchId);
      if (entry) {
        entry.messages = [];
        entry.listeners.forEach((listener) => listener([]));
        entry.typingState.clear();
        entry.typingListeners.forEach((listener) => listener([]));
        cleanupChannel(matchId);
      }
    },
  };
};

let realtimeAdapterInstance: MatchChatAdapter | null = null;

const resolveDefaultAdapter = (): MatchChatAdapter => {
  if (typeof window === 'undefined') {
    return localStorageAdapter;
  }
  if (supabase) {
    if (!realtimeAdapterInstance) {
      realtimeAdapterInstance = createRealtimeMatchChatAdapter(supabase);
    }
    return realtimeAdapterInstance;
  }
  return localStorageAdapter;
};

const useSharedAdapter = (adapter?: MatchChatAdapter | null): MatchChatAdapter | null => {
  const defaultAdapterRef = useRef<MatchChatAdapter | null>(null);
  if (!defaultAdapterRef.current) {
    defaultAdapterRef.current = adapter ?? resolveDefaultAdapter();
  } else if (adapter && defaultAdapterRef.current !== adapter) {
    defaultAdapterRef.current = adapter;
  }
  return defaultAdapterRef.current;
};

export const useMatchChat = ({ matchId, author, adapter }: UseMatchChatOptions): UseMatchChatReturn => {
  const activeAdapter = useSharedAdapter(adapter);
  const [messages, setMessages] = useState<MatchChatMessage[]>([]);
  const [reactions, setReactions] = useState<MatchChatReaction[]>([]);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready'>('idle');
  const [typingUsers, setTypingUsers] = useState<MatchChatAuthor[]>([]);

  useEffect(() => {
    if (!matchId || !activeAdapter) {
      setReactions([]);
      setMessages([]);
      setStatus('idle');
      return;
    }
    let isMounted = true;
    setStatus('loading');
    activeAdapter
      .loadHistory(matchId)
      .then((history) => {
        if (!isMounted) return;
        setMessages(sortMessages(history));
        setStatus('ready');
      })
      .catch((error) => {
        console.warn('useMatchChat: failed to load history', error);
        if (isMounted) {
          setMessages([]);
          setStatus('ready');
        }
      });

    const unsubscribe = activeAdapter.subscribe?.(matchId, (next) => {
      setMessages(sortMessages(next));
    });

    return () => {
      isMounted = false;
      unsubscribe?.();
    };
  }, [activeAdapter, matchId]);

  useEffect(() => {
    if (!matchId || !activeAdapter || !activeAdapter.subscribeTyping) {
      setTypingUsers([]);
      return;
    }
    const unsubscribe = activeAdapter.subscribeTyping(matchId, (authors) => {
      setTypingUsers(authors);
    });
    return () => {
      unsubscribe();
    };
  }, [activeAdapter, matchId]);

  useEffect(() => {
    if (!matchId || !activeAdapter || !activeAdapter.subscribeReactions) {
      setReactions([]);
      return;
    }
    const unsubscribe = activeAdapter.subscribeReactions(matchId, (incoming) => {
      // For now, we'll just append reactions. The UI can aggregate them.
      // A more robust solution might involve acks or a more complex state.
      setReactions((current) => [...current, ...incoming]);
    });
    return () => {
      unsubscribe();
    };
  }, [activeAdapter, matchId]);

  const sendMessage = useCallback(
    async (text: string) => {
      if (!matchId || !activeAdapter || !author) {
        return;
      }
      const trimmed = text.trim();
      if (!trimmed) {
        return;
      }
      const optimisticId = `pending_${generateMessageId()}`;
      const optimisticMessage: MatchChatMessage = {
        id: optimisticId,
        matchId,
        text: trimmed,
        author,
        createdAt: Date.now(),
        pending: true,
      };
      setMessages((current) => sortMessages([...current, optimisticMessage]));

      try {
        const saved = await activeAdapter.persistMessage(matchId, { text: trimmed, author });
        setMessages((current) =>
          sortMessages(
            current.map((message) => (message.id === optimisticId ? saved : message)),
          ),
        );
      } catch (error) {
        console.warn('useMatchChat: failed to send message', error);
        setMessages((current) => current.filter((message) => message.id !== optimisticId));
        throw error;
      }
    },
    [activeAdapter, author, matchId],
  );

  const sendReaction = useCallback(
    async (messageId: string, emoji: string, removed = false) => {
      if (!matchId || !activeAdapter || !author || !activeAdapter.broadcastReaction) {
        return;
      }
      try {
        await activeAdapter.broadcastReaction(matchId, { messageId, author, emoji, removed });
      } catch (error) {
        console.warn('useMatchChat: failed to send reaction', error);
        throw error;
      }
    },
    [activeAdapter, author, matchId],
  );

  const clearHistory = useCallback(async () => {
    if (!matchId || !activeAdapter || !activeAdapter.clear) {
      return;
    }
    await activeAdapter.clear(matchId);
    setMessages([]);
    setTypingUsers([]);
  }, [activeAdapter, matchId]);

  const notifyTyping = useCallback(
    async (isTyping: boolean) => {
      if (!matchId || !activeAdapter || !author || !activeAdapter.broadcastTyping) {
        return;
      }
      try {
        await activeAdapter.broadcastTyping(matchId, { author, isTyping });
      } catch (error) {
        console.warn('useMatchChat: failed to broadcast typing status', error);
      }
    },
    [activeAdapter, author, matchId],
  );

  return {
    messages,
    reactions,
    status,
    sendMessage,
    sendReaction,
    clearHistory,
    canSend: Boolean(matchId && author && activeAdapter),
    typingUsers,
    notifyTyping,
  };
};
