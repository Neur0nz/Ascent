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

  const title = 'Your Santorini invite is ready';
  const text = joinKey
    ? `Jump into my Santorini match on Ascent — use code ${joinKey} or open the live board link.`
    : 'Jump into my Santorini match on Ascent with this live board link.';

  const navigatorRef = typeof navigator !== 'undefined' ? navigator : null;
  try {
    if (navigatorRef?.share) {
      await navigatorRef.share({ title, text, url: joinLink });
      toast({
        status: 'success',
        title: 'Invite shared',
        description: 'Shared with a rich preview — perfect for WhatsApp or Discord.',
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
