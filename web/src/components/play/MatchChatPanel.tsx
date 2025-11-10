import { ArrowUpIcon, SmallCloseIcon } from '@chakra-ui/icons';
import {
  Box,
  Button,
  Card,
  CardBody,
  Flex,
  HStack,
  IconButton,
  Spinner,
  Stack,
  Text,
  Textarea,
  Tooltip,
  useColorModeValue,
} from '@chakra-ui/react';
import { FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import type { MatchChatMessage } from '@hooks/useMatchChat';

interface MatchChatPanelProps {
  matchId: string | null;
  messages: MatchChatMessage[];
  status: 'idle' | 'loading' | 'ready';
  onSend: (text: string) => Promise<void>;
  canSend: boolean;
  currentUserId: string | null;
  isReadOnly?: boolean;
  onClearHistory?: () => Promise<void> | void;
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
  status,
  onSend,
  canSend,
  currentUserId,
  isReadOnly = false,
  onClearHistory,
}: MatchChatPanelProps) {
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const bgSelf = useColorModeValue('teal.50', 'teal.900');
  const bgOther = useColorModeValue('gray.50', 'blackAlpha.300');
  const badgeBg = useColorModeValue('orange.50', 'orange.900');
  const badgeColor = useColorModeValue('orange.800', 'orange.200');
  const helperColor = useColorModeValue('gray.600', 'gray.300');
  const bubbleShadow = useColorModeValue('md', 'sm');
  const listBg = useColorModeValue('white', 'blackAlpha.200');

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

  useEffect(() => {
    if (!listRef.current) {
      return;
    }
    listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages]);

  const trySendDraft = async () => {
    if (disableInput || !draft.trim()) {
      return;
    }
    setSending(true);
    setError(null);
    try {
      await onSend(draft);
      setDraft('');
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

  const handleClear = async () => {
    if (!onClearHistory || !matchId) {
      return;
    }
    await onClearHistory();
  };

  return (
    <Card w="100%">
      <CardBody px={3} py={3}>
        <Stack spacing={3}>
          <Flex justify="space-between" align="center">
            <Text fontWeight="semibold" fontSize="sm">
              Chat
            </Text>
            {onClearHistory ? (
              <Tooltip label="Clear your copy of the chat history for this match">
                <IconButton
                  size="sm"
                  aria-label="Clear chat history"
                  icon={<SmallCloseIcon />}
                  variant="ghost"
                  onClick={handleClear}
                />
              </Tooltip>
            ) : null}
          </Flex>
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
                  return (
                    <Flex key={message.id} justify={isSelf ? 'flex-end' : 'flex-start'}>
                      <Box
                        maxW="80%"
                        bg={isSelf ? bgSelf : bgOther}
                        borderRadius="lg"
                        px={3}
                        py={2}
                        boxShadow={bubbleShadow}
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

          <form onSubmit={handleSubmit}>
            <Stack spacing={2}>
              <Textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={handleTextareaKeyDown}
                placeholder={placeholder}
                isDisabled={disableInput || sending}
                resize="none"
                rows={2}
              />
              <Flex justify="space-between" align="center" gap={3} wrap="wrap">
                <Text fontSize="xs" color={error ? 'red.400' : helperColor} flex="1 1 auto">
                  {error ?? 'Enter to send · Shift+Enter for a newline.'}
                </Text>
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
              </Flex>
            </Stack>
          </form>
        </Stack>
      </CardBody>
    </Card>
  );
}
