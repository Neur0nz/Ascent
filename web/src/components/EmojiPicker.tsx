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
      <Box as="span" role="img" aria-hidden="true" fontSize="lg">
        🙂
      </Box>
    ),
    [],
  );

  return (
    <Popover placement="top" trigger="click" closeOnBlur closeOnEsc>
      {({ onClose }) => (
        <>
          <PopoverTrigger>
            <IconButton
              aria-label="Send emoji"
              size="sm"
              variant="ghost"
              isDisabled={isDisabled}
              icon={triggerLabel}
            />
          </PopoverTrigger>
          <PopoverContent
            bg={popoverBg}
            borderColor={popoverBorder}
            borderWidth="1px"
            shadow="lg"
            width="auto"
          >
            <PopoverArrow bg={popoverBg} />
            <PopoverBody>
              <HStack spacing={1}>
                {EMOJIS.map((emoji) => (
                  <Button
                    key={emoji}
                    size="sm"
                    variant="ghost"
                    fontSize="xl"
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
