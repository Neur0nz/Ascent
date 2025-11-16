import { ArrowUpIcon, SmallCloseIcon } from '@chakra-ui/icons';
import {
  Box,
  Button,
  Card,
  CardBody,
  Flex,
  HStack,
  Icon,
  IconButton,
  Spinner,
  Stack,
  Text,
  Textarea,
  Tooltip,
  useColorModeValue,
  useToast,
} from '@chakra-ui/react';
import {
  ChangeEvent,
  FormEvent,
  KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { MatchChatAuthor, MatchChatMessage, MatchChatReaction } from '@hooks/useMatchChat';
import { FaThumbsUp } from 'react-icons/fa';
import { motion } from 'framer-motion';

const MotionBox = motion(Box);

interface MatchChatPanelProps {
  matchId: string | null;
  messages: MatchChatMessage[];
  reactions: MatchChatReaction[];
  status: 'idle' | 'loading' | 'ready';
  onSend: (text: string) => Promise<void>;
  onReact: (messageId: string, emoji: string, removed?: boolean) => Promise<void>;
  canSend: boolean;
  currentUserId: string | null;
  isReadOnly?: boolean;
  onClearHistory?: () => Promise<void> | void;
  typingUsers?: MatchChatAuthor[];
  onTypingStatusChange?: (isTyping: boolean) => Promise<void> | void;
}

const formatTimestamp = (value: number): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

export function MatchChatPanel({
  matchId,
  messages,
  reactions,
  status,
  onSend,
  onReact,
  canSend,
  currentUserId,
  isReadOnly = false,
  onClearHistory,
  typingUsers = [],
  onTypingStatusChange,
}: MatchChatPanelProps) {
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [isVisible, setIsVisible] = useState(true);
  const lastMessageIdRef = useRef<string | null>(null);
  const toast = useToast();
  const toastIdRef = useRef<string | number | undefined>();
  const bgSelf = useColorModeValue('teal.50', 'teal.900');
  const bgOther = useColorModeValue('gray.50', 'blackAlpha.300');
  const badgeBg = useColorModeValue('orange.50', 'orange.900');
  const badgeColor = useColorModeValue('orange.800', 'orange.200');
  const helperColor = useColorModeValue('gray.600', 'gray.300');
  const bubbleShadow = useColorModeValue('md', 'sm');
  const listBg = useColorModeValue('white', 'blackAlpha.200');
  const reactionBg = useColorModeValue('whiteAlpha.900', 'blackAlpha.400');
  const reactionBorder = useColorModeValue('gray.200', 'whiteAlpha.300');
  const reactionTextColor = useColorModeValue('gray.800', 'gray.100');

  const disableInput = !canSend || isReadOnly || status === 'idle';
  const placeholder = useMemo(() => {
    if (isReadOnly) {
      return 'Chat is locked for this match.';
    }
    if (!matchId) {
      return 'Join a match to start chatting.';
    }
    if (!canSend) {
      return 'Sign in or rejoin the match to chat.';
    }
    return 'Be kind! Coordinate rematches or say hello.';
  }, [canSend, isReadOnly, matchId]);

  const emitTypingStatus = useCallback(
    (isTyping: boolean) => {
      if (!onTypingStatusChange) {
        return;
      }
      void onTypingStatusChange(isTyping);
    },
    [onTypingStatusChange],
  );

  const scheduleTypingNotification = useCallback(() => {
    if (disableInput) {
      return;
    }
    emitTypingStatus(true);
    if (typingTimerRef.current) {
      clearTimeout(typingTimerRef.current);
    }
    typingTimerRef.current = setTimeout(() => {
      typingTimerRef.current = null;
      emitTypingStatus(false);
    }, 1200);
  }, [disableInput, emitTypingStatus]);

  const stopTypingNotification = useCallback(() => {
    if (typingTimerRef.current) {
      clearTimeout(typingTimerRef.current);
      typingTimerRef.current = null;
    }
    emitTypingStatus(false);
  }, [emitTypingStatus]);

  useEffect(() => {
    if (!listRef.current) {
      return;
    }
    listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages]);

  useEffect(() => {
    return () => {
      stopTypingNotification();
    };
  }, [stopTypingNotification]);

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined' || !cardRef.current) {
      return undefined;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsVisible(Boolean(entry.isIntersecting && entry.intersectionRatio > 0));
      },
      { threshold: 0.1 },
    );
    observer.observe(cardRef.current);
    return () => {
      observer.disconnect();
    };
  }, []);

  const aggregatedReactions = useMemo(() => {
    const entries: Record<
      string,
      {
        emoji: string;
        authorsMap: Map<string, MatchChatAuthor>;
        authors(): MatchChatAuthor[];
      }
    > = {};
    for (const reaction of reactions) {
      const key = reaction.messageId;
      if (!entries[key]) {
        entries[key] = {
          emoji: reaction.emoji,
          authorsMap: new Map(),
          authors() {
            return Array.from(this.authorsMap.values());
          },
        };
      }
      const authorKey =
        (reaction.author.id && `id:${reaction.author.id}`) ||
        (reaction.author.name && `name:${reaction.author.name}`) ||
        `idx:${entries[key].authorsMap.size}`;
      if (reaction.removed) {
        entries[key].authorsMap.delete(authorKey);
      } else {
        entries[key].authorsMap.set(authorKey, reaction.author);
      }
    }
    const normalized: Record<string, { emoji: string; authors: MatchChatAuthor[] }> = {};
    for (const messageId of Object.keys(entries)) {
      normalized[messageId] = {
        emoji: entries[messageId].emoji,
        authors: entries[messageId].authors(),
      };
    }
    return normalized;
  }, [reactions]);

  useEffect(() => {
    const latest = messages[messages.length - 1];
    if (!latest) {
      lastMessageIdRef.current = null;
      return;
    }
    if (lastMessageIdRef.current === latest.id) {
      return;
    }
    lastMessageIdRef.current = latest.id;

    if (isVisible) {
      return;
    }
    if (currentUserId && latest.author.id && currentUserId === latest.author.id) {
      return;
    }

    if (toastIdRef.current) {
      toast.close(toastIdRef.current);
    }

    toastIdRef.current = toast({
      title: latest.author.name ?? 'New message',
      description: latest.text,
      status: 'info',
      duration: 2000,
      isClosable: false,
      position: 'top-right',
    });
  }, [currentUserId, isVisible, messages, toast]);

  const otherTypers = typingUsers.filter((user) => {
    if (currentUserId && user.id) {
      return user.id !== currentUserId;
    }
    return true;
  });

  const typingLabel =
    otherTypers.length === 0
      ? null
      : otherTypers.length === 1
      ? `${otherTypers[0].name} is typing…`
      : `${otherTypers.length} players are typing…`;

  const trySendDraft = async () => {
    if (disableInput || !draft.trim()) {
      return;
    }
    setSending(true);
    setError(null);
    try {
      await onSend(draft);
      setDraft('');
      stopTypingNotification();
    } catch (err) {
      console.error('MatchChatPanel: failed to send', err);
      setError('Unable to send message. Please try again.');
    } finally {
      setSending(false);
    }
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    void trySendDraft();
  };

  const handleTextareaKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      void trySendDraft();
    }
  };

  const handleDraftChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    setDraft(event.target.value);
    scheduleTypingNotification();
  };

  const handleClear = async () => {
    if (!onClearHistory || !matchId) {
      return;
    }
    await onClearHistory();
  };

  const handleReactToMessage = useCallback(
    (messageId: string) => {
      if (!currentUserId || isReadOnly) {
        return;
      }
      const reaction = aggregatedReactions[messageId];
      const hasReacted = Boolean(
        reaction &&
          reaction.authors.some((author) => {
            return (
              (currentUserId && author.id === currentUserId) ||
              (!author.id && author.name && currentUserId === author.name)
            );
          }),
      );
      void onReact(messageId, '👍', hasReacted);
    },
    [aggregatedReactions, currentUserId, isReadOnly, onReact],
  );

  return (
    <Card ref={cardRef} w="100%">
      <CardBody px={3} py={2}>
        <Stack spacing={2}>
          <Box
            ref={listRef}
            borderWidth="1px"
            borderRadius="lg"
            p={2}
            maxH={{ base: '38vh', md: '260px' }}
            minH={{ base: '140px', md: '180px' }}
            overflowY="auto"
            bg={listBg}
          >
            {status === 'loading' ? (
              <Flex h="100%" align="center" justify="center">
                <Spinner />
              </Flex>
            ) : messages.length === 0 ? (
              <Flex h="100%" align="center" justify="center">
                <Text fontSize="sm" color={helperColor} textAlign="center">
                  Start the conversation! Everyone currently watching this match will see new messages immediately.
                </Text>
              </Flex>
            ) : (
              <Stack spacing={3}>
                {messages.map((message) => {
                  const isSelf = currentUserId && message.author.id && currentUserId === message.author.id;
                  const reaction = aggregatedReactions[message.id];
                  const tooltipLabel =
                    reaction && reaction.authors.length > 0
                      ? `Reacted by ${reaction.authors.map((a) => a.name).join(', ')}`
                      : undefined;
                  return (
                    <Flex key={message.id} justify={isSelf ? 'flex-end' : 'flex-start'}>
                      <Box
                        maxW="80%"
                        bg={isSelf ? bgSelf : bgOther}
                        borderRadius="lg"
                        px={3}
                        py={2}
                        boxShadow={bubbleShadow}
                        onDoubleClick={() => handleReactToMessage(message.id)}
                        cursor={currentUserId && !isReadOnly ? 'pointer' : undefined}
                        role={currentUserId && !isReadOnly ? 'button' : undefined}
                      >
                        <HStack spacing={2} justify="space-between" align="baseline">
                          <Text fontSize="xs" fontWeight="semibold">
                            {isSelf ? 'You' : message.author.name}
                          </Text>
                          <Text fontSize="xs" color={helperColor}>
                            {formatTimestamp(message.createdAt)}
                          </Text>
                        </HStack>
                        <Text fontSize="sm" whiteSpace="pre-wrap">
                          {message.text}
                        </Text>
                        {reaction ? (
                          <Tooltip label={tooltipLabel} placement="top" hasArrow>
                            <MotionBox
                              initial={{ scale: 0.5, opacity: 0 }}
                              animate={{ scale: 1, opacity: 1 }}
                              transition={{ duration: 0.2 }}
                            >
                              <HStack
                                spacing={1}
                                mt={2}
                                px={2}
                                py={1}
                                borderRadius="full"
                                bg={reactionBg}
                                borderWidth="1px"
                                borderColor={reactionBorder}
                                align="center"
                                justify="center"
                                maxW="120px"
                              >
                                <Icon as={FaThumbsUp} boxSize="4" color={reactionTextColor} />
                                <Text fontSize="xs" fontWeight="semibold" color={reactionTextColor}>
                                  {reaction.authors.length}
                                </Text>
                              </HStack>
                            </MotionBox>
                          </Tooltip>
                        ) : null}
                        {message.pending ? (
                          <HStack spacing={1} mt={1}>
                            <Spinner size="xs" />
                            <Text fontSize="xs" color={helperColor}>
                              Sending…
                            </Text>
                          </HStack>
                        ) : null}
                      </Box>
                    </Flex>
                  );
                })}
              </Stack>
            )}
          </Box>
          {typingLabel ? (
            <Text fontSize="xs" color={helperColor} fontStyle="italic">
              {typingLabel}
            </Text>
          ) : null}
          <form onSubmit={handleSubmit}>
            <Stack spacing={2}>
              <Textarea
                value={draft}
                onChange={handleDraftChange}
                onKeyDown={handleTextareaKeyDown}
                onBlur={stopTypingNotification}
                placeholder={placeholder}
                isDisabled={disableInput || sending}
                resize="none"
                rows={2}
              />
              <Flex justify="space-between" align={{ base: 'stretch', sm: 'center' }} gap={3} wrap="wrap">
                <Box flex="1 1 auto">
                  {error ? (
                    <Text fontSize="xs" color="red.400">
                      {error}
                    </Text>
                  ) : null}
                </Box>
                <HStack spacing={2}>
                  <Button
                    type="submit"
                    colorScheme="teal"
                    rightIcon={<ArrowUpIcon />}
                    isDisabled={disableInput || sending || !draft.trim()}
                    isLoading={sending}
                    size="sm"
                  >
                    Send
                  </Button>
                </HStack>
              </Flex>
            </Stack>
          </form>
        </Stack>
      </CardBody>
    </Card>
  );
}
