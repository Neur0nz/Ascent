import { Box, Button, HStack, Text, useToast } from '@chakra-ui/react';
import { useEffect, useRef } from 'react';
import type { EvaluationJobStatus } from '@/types/evaluation';
import { useEvaluationJobs } from '@hooks/useEvaluationJobs';

interface EvaluationJobToastsProps {
  onNavigateToAnalyze: (jobId: string) => void;
}

export function EvaluationJobToasts({ onNavigateToAnalyze }: EvaluationJobToastsProps) {
  const toast = useToast();
  const { jobs } = useEvaluationJobs();
  const notifiedRef = useRef<Map<string, EvaluationJobStatus>>(new Map());

  useEffect(() => {
    Object.values(jobs).forEach((job) => {
      const lastStatus = notifiedRef.current.get(job.id);
      if (job.status === 'success' && lastStatus !== 'success') {
        notifiedRef.current.set(job.id, 'success');
        toast({
          position: 'bottom-right',
          duration: 9000,
          render: ({ onClose }) => (
            <Box
              bg="gray.800"
              color="white"
              px={4}
              py={3}
              borderRadius="md"
              boxShadow="lg"
              borderWidth="1px"
              borderColor="whiteAlpha.300"
            >
              <Text fontWeight="bold" mb={2}>
                Evaluation complete
              </Text>
              <Text fontSize="sm" mb={3}>
                {job.matchLabel} is ready. View the analysis graph whenever you're ready.
              </Text>
              <HStack justify="flex-end">
                <Button
                  size="sm"
                  colorScheme="teal"
                  onClick={() => {
                    onNavigateToAnalyze(job.id);
                    onClose();
                  }}
                >
                  Go to Analyze
                </Button>
              </HStack>
            </Box>
          ),
        });
      } else if (job.status === 'error' && lastStatus !== 'error') {
        notifiedRef.current.set(job.id, 'error');
        toast({
          status: 'error',
          title: 'Evaluation failed',
          description: job.error ?? 'The AI could not finish this evaluation.',
          duration: 7000,
          isClosable: true,
        });
      }
    });
  }, [jobs, onNavigateToAnalyze, toast]);

  return null;
}

export default EvaluationJobToasts;

