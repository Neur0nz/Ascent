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

export interface MatchChatAdapter {
  loadHistory(matchId: string): Promise<MatchChatMessage[]>;
  persistMessage(matchId: string, draft: MatchChatDraft): Promise<MatchChatMessage>;
  subscribe?(matchId: string, callback: (messages: MatchChatMessage[]) => void): () => void;
  clear?(matchId: string): Promise<void>;
}

export interface UseMatchChatOptions {
  matchId: string | null | undefined;
  author: MatchChatAuthor | null;
  adapter?: MatchChatAdapter | null;
}

export interface UseMatchChatReturn {
  messages: MatchChatMessage[];
  status: 'idle' | 'loading' | 'ready';
  sendMessage: (text: string) => Promise<void>;
  canSend: boolean;
  clearHistory: () => Promise<void>;
}

const STORAGE_KEY_PREFIX = 'santorini:matchChat:';
const MAX_SAVED_MESSAGES = 200;
const CHAT_CHANNEL_PREFIX = 'match-chat-';
const CHAT_EVENT_NAME = 'chat-message';

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
  messages: MatchChatMessage[];
}

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
      messages: sortMessages(readFromStorage(matchId)),
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
    if (!entry || entry.listeners.size > 0) {
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
    async clear(matchId) {
      await localStorageAdapter.clear?.(matchId);
      const entry = channelEntries.get(matchId);
      if (entry) {
        entry.messages = [];
        entry.listeners.forEach((listener) => listener([]));
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
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready'>('idle');

  useEffect(() => {
    if (!matchId || !activeAdapter) {
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

  const clearHistory = useCallback(async () => {
    if (!matchId || !activeAdapter || !activeAdapter.clear) {
      return;
    }
    await activeAdapter.clear(matchId);
    setMessages([]);
  }, [activeAdapter, matchId]);

  return {
    messages,
    status,
    sendMessage,
    clearHistory,
    canSend: Boolean(matchId && author && activeAdapter),
  };
};
