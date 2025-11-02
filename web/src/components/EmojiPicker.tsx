import {
  Box,
  Button,
  HStack,
  IconButton,
  Popover,
  PopoverArrow,
  PopoverBody,
  PopoverContent,
  PopoverTrigger,
  useColorModeValue,
} from '@chakra-ui/react';
import { useMemo } from 'react';

const EMOJIS = ['😀', '👍', '❤️', '🔥', '💪', '😮', '👏'];

interface EmojiPickerProps {
  onSelect: (emoji: string) => void;
  isDisabled?: boolean;
}

function EmojiPicker({ onSelect, isDisabled }: EmojiPickerProps) {
  const popoverBg = useColorModeValue('white', 'gray.700');
  const popoverBorder = useColorModeValue('gray.200', 'whiteAlpha.200');
  const triggerLabel = useMemo(
    () => (
      <Box as="span" role="img" aria-hidden="true" fontSize="2xl">
        🙂
      </Box>
    ),
    [],
  );

  return (
    <Popover placement="top" trigger="click" closeOnBlur={false} closeOnEsc>
      {({ onClose }) => (
        <>
          <PopoverTrigger>
            <IconButton
              aria-label="Send emoji"
              size="md"
              variant="ghost"
              isDisabled={isDisabled}
              icon={triggerLabel}
              fontSize="2xl"
            />
          </PopoverTrigger>
          <PopoverContent
            bg={popoverBg}
            borderColor={popoverBorder}
            borderWidth="1px"
            shadow="xl"
            width="auto"
          >
            <PopoverArrow bg={popoverBg} />
            <PopoverBody px={2} py={2}>
              <HStack spacing={1.5}>
                {EMOJIS.map((emoji) => (
                  <Button
                    key={emoji}
                    size="md"
                    variant="ghost"
                    fontSize="2xl"
                    px={2}
                    py={1}
                    onClick={() => {
                      onSelect(emoji);
                      onClose();
                    }}
                  >
                    <span role="img" aria-label="emoji">
                      {emoji}
                    </span>
                  </Button>
                ))}
              </HStack>
            </PopoverBody>
          </PopoverContent>
        </>
      )}
    </Popover>
  );
}

export default EmojiPicker;
