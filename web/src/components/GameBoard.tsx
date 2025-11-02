import {
  AspectRatio,
  Box,
  Button,
  Flex,
  Grid,
  GridItem,
  Slider,
  SliderFilledTrack,
  SliderThumb,
  SliderTrack,
  Text,
  useColorModeValue,
  useBreakpointValue,
} from '@chakra-ui/react';
import { useEffect, useMemo, useState } from 'react';
import type { BoardCell, ButtonsState } from '@hooks/useSantorini';

interface GameBoardProps {
  board: BoardCell[][];
  selectable: boolean[][];
  cancelSelectable?: boolean[][];
  onCellClick: (y: number, x: number) => void;
  onCellHover: (y: number, x: number) => void;
  onCellLeave: (y: number, x: number) => void;
  buttons: ButtonsState;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  undoLabel?: string;
  hideRedoButton?: boolean;
  undoDisabledOverride?: boolean;
  showBoardSizeControl?: boolean;
  showPrimaryControls?: boolean;
  undoIsLoading?: boolean;
  isTurnActive?: boolean;
  turnHighlightColor?: string;
}

function GameBoard({
  board,
  selectable,
  cancelSelectable,
  onCellClick,
  onCellHover,
  onCellLeave,
  buttons,
  undo,
  redo,
  undoLabel,
  hideRedoButton,
  undoDisabledOverride,
  showBoardSizeControl = true,
  showPrimaryControls = true,
  undoIsLoading = false,
  isTurnActive = false,
  turnHighlightColor,
}: GameBoardProps) {
  const cellBg = useColorModeValue('gray.50', 'gray.700');
  const selectableBg = useColorModeValue('teal.100', 'teal.700');
  const cancelSelectableBg = useColorModeValue('orange.200', 'orange.700');
  const setupSelectableBg = useColorModeValue('green.100', 'green.700');
  const labelColor = useColorModeValue('gray.600', 'whiteAlpha.700');
  const subtleLabelColor = useColorModeValue('gray.500', 'whiteAlpha.600');
  const boardFrameBg = useColorModeValue('gray.100', 'blackAlpha.500');
  const defaultBorderColor = useColorModeValue('gray.300', 'whiteAlpha.300');
  const highlightBorderColor = useColorModeValue('yellow.400', 'yellow.300');
  const actionBorderColor = useColorModeValue('gray.200', 'whiteAlpha.200');
  const panelTextColor = useColorModeValue('gray.800', 'whiteAlpha.800');
  const buildingColor = useColorModeValue('gray.900', 'whiteAlpha.900');
  const setupPanelBg = useColorModeValue('green.500', 'green.600');
  const setupPanelBorder = useColorModeValue('green.300', 'green.500');
  const setupPrimaryTextColor = useColorModeValue('white', 'white');
  const setupSecondaryTextColor = useColorModeValue('whiteAlpha.900', 'whiteAlpha.800');
  const loadingStatusColor = useColorModeValue('teal.600', 'teal.200');
  const boardSizeControlVisible = useBreakpointValue({ base: false, md: true });
  const [boardPixels, setBoardPixels] = useState<number>(() => {
    if (typeof window === 'undefined') {
      return 600;
    }
    const stored = window.localStorage.getItem('santorini:boardSize');
    const parsed = Number(stored);
    if (Number.isFinite(parsed) && parsed >= 320 && parsed <= 960) {
      return parsed;
    }
    const viewportWidth = window.innerWidth || 0;
    if (viewportWidth <= 0) {
      return 720;
    }
    const preferred = Math.round(viewportWidth - 96);
    return Math.min(960, Math.max(360, preferred));
  });

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    window.localStorage.setItem('santorini:boardSize', String(boardPixels));
  }, [boardPixels]);

  const boardColumns = Math.max(1, board[0]?.length ?? board.length);
  const gridTemplateColumns = `repeat(${boardColumns}, 1fr)`;

  const boardMaxWidth = useMemo(() => `min(${boardPixels}px, 100vw)`, [boardPixels]);
  const defaultGlowColor = useColorModeValue('teal.400', 'teal.200');
  const activeGlowColor = turnHighlightColor ?? defaultGlowColor;
  const boardBoxShadow = isTurnActive
    ? `0 0 0 3px ${activeGlowColor}, 0 0 30px ${activeGlowColor}66`
    : '2xl';
  const responsiveBoardShadow = useBreakpointValue({ base: 'none', md: boardBoxShadow });
  const responsiveBorderRadius = useBreakpointValue({ base: 'none', md: 'xl' });
  const responsiveBorderWidth = useBreakpointValue({ base: '0px', md: isTurnActive ? '2px' : '0px' });
  const responsiveFrameBg = useBreakpointValue({ base: 'transparent', md: boardFrameBg });

  return (
    <Flex
      direction="column"
      gap={{ base: 6, md: 7 }}
      w="100%"
      maxW="100%"
      mx="auto"
    >
      <Flex direction="column" gap={3} w="100%">
        {showBoardSizeControl && boardSizeControlVisible && (
          <Flex align="center" gap={3} w="100%" px={{ base: 0, sm: 1 }}>
            <Text fontSize="sm" color={labelColor} whiteSpace="nowrap">
              Board size
            </Text>
            <Slider
              aria-label="Board size"
              value={boardPixels}
              onChange={setBoardPixels}
              min={320}
              max={960}
              step={10}
              colorScheme="teal"
              flex={1}
            >
              <SliderTrack bg={defaultBorderColor}>
                <SliderFilledTrack />
              </SliderTrack>
              <SliderThumb boxSize={5} />
            </Slider>
            <Text fontSize="sm" color={subtleLabelColor} w="64px" textAlign="right">
              {Math.round(boardPixels)}px
            </Text>
          </Flex>
        )}
        <AspectRatio ratio={1} w="100%" maxW={boardMaxWidth} mx="auto">
          <Flex
            direction="column"
            w="100%"
            h="100%"
            bg={responsiveFrameBg ?? boardFrameBg}
            p={{ base: 0, md: 6 }}
            borderRadius={responsiveBorderRadius ?? 'xl'}
            boxShadow={responsiveBoardShadow ?? boardBoxShadow}
            borderWidth={responsiveBorderWidth ?? (isTurnActive ? '2px' : '0px')}
            borderColor={isTurnActive ? activeGlowColor : 'transparent'}
            transition="box-shadow 0.3s ease, border-color 0.3s ease"
          >
            <Grid
              templateColumns={gridTemplateColumns}
              gap={{ base: 1, sm: 2, md: 3 }}
              w="100%"
              h="100%"
              flex={1}
            >
              {board.map((row, y) =>
                row.map((cell, x) => {
                  const isSelectable = selectable[y]?.[x];
                      const isCancelSelectable = cancelSelectable?.[y]?.[x];
                  const isSetupSelectable = buttons.setupMode && cell.worker === 0; // Empty cells during setup
                  const highlight = cell.highlight;
                      const canClick = isSelectable || isCancelSelectable || isSetupSelectable;
                  return (
                    <GridItem key={`${y}-${x}`}>
                      <AspectRatio ratio={1} w="100%">
                        <Box
                          role="button"
                          tabIndex={0}
                          aria-label={`Cell ${y},${x}`}
                          onClick={() => onCellClick(y, x)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              onCellClick(y, x);
                            }
                          }}
                          onMouseEnter={() => onCellHover(y, x)}
                          onMouseLeave={() => onCellLeave(y, x)}
                          cursor={canClick ? 'pointer' : 'default'}
                          borderRadius="lg"
                          borderWidth={highlight ? '3px' : '1px'}
                          borderColor={highlight ? highlightBorderColor : defaultBorderColor}
                          bg={
                            isSetupSelectable
                              ? setupSelectableBg
                                  : isCancelSelectable
                                    ? cancelSelectableBg
                              : isSelectable
                                ? selectableBg
                                : cellBg
                          }
                          display="flex"
                          alignItems="center"
                          justifyContent="center"
                          transition="all 0.2s ease"
                          position="relative"
                          _hover={{ boxShadow: canClick ? 'dark-lg' : undefined }}
                        >
                          <Box
                            pointerEvents="none"
                            display="flex"
                            alignItems="center"
                            justifyContent="center"
                            w="100%"
                            h="100%"
                            color={buildingColor}
                            sx={{
                              '& svg': {
                                width: '88%',
                                height: '88%',
                                maxWidth: '88%',
                                maxHeight: '88%',
                              },
                            }}
                            dangerouslySetInnerHTML={{ __html: cell.svg }}
                          />
                        </Box>
                      </AspectRatio>
                    </GridItem>
                  );
                }),
              )}
            </Grid>
          </Flex>
        </AspectRatio>
      </Flex>
      {showPrimaryControls && (
        <Flex
          gap={3}
          direction={{ base: 'column', sm: 'row' }}
          w="100%"
          align="stretch"
        >
        <Button
          flex="1"
          w={{ base: '100%', sm: 'auto' }}
          size="lg"
          py={{ base: 5, sm: 6 }}
          onClick={undo}
          isDisabled={undoDisabledOverride ?? !buttons.canUndo}
          isLoading={undoIsLoading}
          colorScheme="green"
          boxShadow="lg"
        >
            {undoLabel ?? 'Undo'}
          </Button>
          {!hideRedoButton && (
            <Button
              flex="1"
              w={{ base: '100%', sm: 'auto' }}
              size="lg"
              py={{ base: 5, sm: 6 }}
              onClick={redo}
              isDisabled={!buttons.canRedo}
              colorScheme="purple"
              boxShadow="lg"
            >
              Redo
            </Button>
          )}
        </Flex>
      )}
      <Box
        px={4}
        py={3}
        borderRadius="md"
        bg={buttons.setupMode ? setupPanelBg : boardFrameBg}
        borderWidth="1px"
        borderColor={buttons.setupMode ? setupPanelBorder : actionBorderColor}
        textAlign={{ base: 'center', sm: 'left' }}
      >
        <Text fontSize="sm" color={buttons.setupMode ? setupPrimaryTextColor : panelTextColor}>
          {buttons.status}
        </Text>
        {buttons.loading && (
          <Text
            mt={2}
            fontSize="sm"
            color={buttons.setupMode ? setupSecondaryTextColor : loadingStatusColor}
          >
            AI thinking...
          </Text>
        )}
        {buttons.setupMode && (
          <Text mt={2} fontSize="sm" color={setupSecondaryTextColor}>
            Setup Mode: Click empty cells to place workers
          </Text>
        )}
      </Box>
    </Flex>
  );
}

export default GameBoard;
