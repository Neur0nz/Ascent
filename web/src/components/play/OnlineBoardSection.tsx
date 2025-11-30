import { Box, type BoxProps } from '@chakra-ui/react';
import GameBoard, { type GameBoardProps } from '@components/GameBoard';
import { useSurfaceTokens } from '@/theme/useSurfaceTokens';

export interface OnlineBoardSectionProps extends GameBoardProps {
  variant?: 'card' | 'responsive';
  containerProps?: BoxProps;
}

function OnlineBoardSection({ variant = 'card', containerProps, ...gameBoardProps }: OnlineBoardSectionProps) {
  const { panelBg, cardBorder } = useSurfaceTokens();
  const variantStyles =
    variant === 'card'
      ? {
          bg: panelBg,
          borderRadius: 'xl',
          borderWidth: '1px',
          borderColor: cardBorder,
          p: { base: 2, md: 3 },
        }
      : {
          bg: { base: 'transparent', md: panelBg },
          borderRadius: { base: 'none', md: 'xl' },
          borderWidth: { base: 0, md: '1px' },
          borderColor: { base: 'transparent', md: cardBorder },
          p: { base: 0, md: 3 },
          boxShadow: { base: 'none', md: 'md' },
        };

  return (
    <Box
      display="flex"
      justifyContent="center"
      w="100%"
      maxW="100%"
      overflow="hidden"
      {...variantStyles}
      {...containerProps}
    >
      <GameBoard {...gameBoardProps} />
    </Box>
  );
}

export default OnlineBoardSection;
