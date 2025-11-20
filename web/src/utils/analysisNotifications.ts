import type { UseToastOptions } from '@chakra-ui/react';

export type AnalysisStartToastMode = 'auto' | 'manual';

export function showEvaluationStartedToast(
  toast: (options?: UseToastOptions) => string | number | undefined,
  {
    matchLabel,
    depth,
    mode = 'manual',
    toastId,
  }: { matchLabel: string; depth: number | null; mode?: AnalysisStartToastMode; toastId?: string },
) {
  const depthText = depth ? `depth ${depth}` : 'default depth';
  const title = mode === 'auto' ? 'Auto analysis started' : 'Evaluation started';
  const description = `Analyzing ${matchLabel} at ${depthText}.`;

  const options: UseToastOptions = {
    id: toastId,
    title,
    description,
    status: 'info',
    duration: 4000,
    isClosable: true,
  };

  toast(options);
}
