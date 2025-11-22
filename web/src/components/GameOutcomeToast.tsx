import { motion } from 'framer-motion';
import { Box, Text, useColorModeValue } from '@chakra-ui/react';
import { CheckCircleIcon, WarningIcon, InfoIcon } from '@chakra-ui/icons';
import type { ToastProps } from '@chakra-ui/react';

interface GameOutcomeToastProps extends ToastProps {
  title: string;
  description: string;
  status: 'success' | 'error' | 'info';
}

const statusMap = {
  success: {
    icon: CheckCircleIcon,
    color: 'green.300',
    bgColor: 'green.700',
  },
  error: {
    icon: WarningIcon,
    color: 'red.300',
    bgColor: 'red.700',
  },
  info: {
    icon: InfoIcon,
    color: 'blue.300',
    bgColor: 'blue.700',
  },
};

export const GameOutcomeToast = ({ title, description, status, ...rest }: GameOutcomeToastProps) => {
  const { icon: Icon, color, bgColor } = statusMap[status];
  const textColor = useColorModeValue('white', 'gray.100');

  return (
    <motion.div
      initial={{ opacity: 0, y: -50, scale: 0.8 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -50, scale: 0.8 }}
      transition={{ duration: 0.3 }}
    >
      <Box
        display="flex"
        alignItems="center"
        p={4}
        bg={bgColor}
        borderRadius="lg"
        boxShadow="lg"
        color={textColor}
        maxW="md"
        minW="xs"
        {...rest}
      >
        <Icon w={6} h={6} color={color} mr={3} />
        <Box>
          <Text fontWeight="bold" fontSize="lg">
            {title}
          </Text>
          <Text fontSize="sm">{description}</Text>
        </Box>
      </Box>
    </motion.div>
  );
};