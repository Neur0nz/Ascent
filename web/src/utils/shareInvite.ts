import type { UseToastOptions } from '@chakra-ui/react';
import { useToast } from '@chakra-ui/react';

type ToastFn = ReturnType<typeof useToast>;

export interface ShareInviteParams {
  joinLink: string;
  joinKey?: string;
  toast: ToastFn;
  fallbackCopy: () => void | Promise<void>;
}

/**
 * Try to share a match invite with a rich preview via the Web Share API, falling back to copying.
 * Returns true when a share/copy attempt succeeds.
 */
export async function shareMatchInvite({ joinLink, joinKey, toast, fallbackCopy }: ShareInviteParams): Promise<boolean> {
  if (!joinLink) {
    return false;
  }

  const title = 'Join my Santorini match';
  const text = joinKey
    ? `Join my Santorini match with code ${joinKey} on Ascent.`
    : 'Join my Santorini match on Ascent.';

  const navigatorRef = typeof navigator !== 'undefined' ? navigator : null;
  try {
    if (navigatorRef?.share) {
      await navigatorRef.share({ title, text, url: joinLink });
      toast({
        status: 'success',
        title: 'Invite shared',
        description: 'Sent via your app with a rich preview.',
        duration: 2500,
        isClosable: true,
      } satisfies UseToastOptions);
      return true;
    }

    await Promise.resolve(fallbackCopy());
    toast({
      status: 'success',
      title: 'Link copied',
      description: 'Paste it into WhatsApp, Discord, or anywhere else.',
      duration: 2500,
      isClosable: true,
    } satisfies UseToastOptions);
    return true;
  } catch (error) {
    console.error('Failed to share match invite', error);
    toast({
      status: 'error',
      title: 'Unable to share invite',
      description: 'Try again or copy the link manually.',
      duration: 3000,
      isClosable: true,
    } satisfies UseToastOptions);
    return false;
  }
}
