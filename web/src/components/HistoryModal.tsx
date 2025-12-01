import { useMemo, useCallback, useState } from 'react';
import {
  Button,
  Drawer,
  DrawerBody,
  DrawerCloseButton,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerOverlay,
  HStack,
  Text,
  useColorModeValue,
} from '@chakra-ui/react';
import type { MoveSummary } from '@hooks/useSantorini';
import MoveHistoryList, { type MoveHistoryItem } from '@components/MoveHistoryList';

interface HistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  history: MoveSummary[];
  jumpToMove: (index: number) => Promise<void>;
}

function HistoryModal({ isOpen, onClose, history, jumpToMove }: HistoryModalProps) {
  const [selectedIndex, setSelectedIndex] = useState(-1);
  
  const handleJump = useCallback(async (index: number) => {
    await jumpToMove(index);
    setSelectedIndex(index);
    onClose();
  }, [jumpToMove, onClose]);

  const handleSelectMove = useCallback((index: number) => {
    setSelectedIndex(index);
    void handleJump(index);
  }, [handleJump]);

  const drawerBg = useColorModeValue('white', 'gray.800');
  const secondaryTextColor = useColorModeValue('gray.600', 'whiteAlpha.700');

  // Convert MoveSummary[] to MoveHistoryItem[]
  const moveHistoryItems: MoveHistoryItem[] = useMemo(() => {
    return history.map((move, index) => {
      const phaseLabel = move.phase === 'placement' ? 'Placement' : move.phase === 'move' ? 'Move' : 'State';
      
      return {
        id: `history-${index}`,
        index,
        label: `${index + 1}. ${phaseLabel}`,
        description: move.description,
        player: move.player,
        board: move.boardAfter ?? move.boardBefore ?? null,
        from: move.phase === 'move' ? move.from : undefined,
        to: move.to,
        build: move.build,
      };
    });
  }, [history]);

  return (
    <Drawer isOpen={isOpen} onClose={onClose} placement="right" size="md">
      <DrawerOverlay />
      <DrawerContent bg={drawerBg}>
        <DrawerCloseButton />
        <DrawerHeader fontWeight="bold">Move history</DrawerHeader>
        <DrawerBody>
          {history.length === 0 ? (
            <Text color={secondaryTextColor}>No moves recorded yet.</Text>
          ) : (
            <MoveHistoryList
              items={moveHistoryItems}
              currentIndex={selectedIndex}
              onSelectMove={handleSelectMove}
              maxHeight="calc(100vh - 200px)"
              showPlayerTags={true}
              showPreviewOnHover={true}
              compact={false}
            />
          )}
        </DrawerBody>
        <DrawerFooter>
          <HStack spacing={3} w="100%" justify="space-between">
            <Button
              variant="ghost"
              onClick={() => history.length > 0 && handleJump(0)}
              isDisabled={history.length === 0}
            >
              Go to start
            </Button>
            <Button
              colorScheme="teal"
              onClick={() => history.length > 0 && handleJump(history.length - 1)}
              isDisabled={history.length === 0}
            >
              Go to end
            </Button>
          </HStack>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}

export default HistoryModal;
