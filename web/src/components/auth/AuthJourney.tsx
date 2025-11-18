import {
  Avatar,
  Box,
  Button,
  HStack,
  Menu,
  MenuButton,
  MenuDivider,
  MenuItem,
  MenuList,
  Spinner,
  Text,
  Tooltip,
  useBoolean,
  useToast,
  useColorModeValue,
} from '@chakra-ui/react';
import { ChevronDownIcon } from '@chakra-ui/icons';
import GoogleIcon from '@components/auth/GoogleIcon';
import type { SupabaseAuthState } from '@hooks/useSupabaseAuth';

interface AuthJourneyProps {
  auth: SupabaseAuthState;
  onNavigateToProfile?: () => void;
}

function AuthJourney({ auth, onNavigateToProfile }: AuthJourneyProps) {
  const { profile, session, loading, error, isConfigured, signInWithGoogle, signOut, refreshProfile } = auth;
  const toast = useToast();
  const [signingOut, setSigningOut] = useBoolean(false);
  const [retrying, setRetrying] = useBoolean(false);
  const signInHoverBg = useColorModeValue('gray.100', 'whiteAlpha.200');
  const signInActiveBg = useColorModeValue('gray.200', 'whiteAlpha.300');
  const menuBg = useColorModeValue('white', 'gray.900');
  const menuBorder = useColorModeValue('gray.200', 'whiteAlpha.200');
  const menuMuted = useColorModeValue('gray.600', 'whiteAlpha.700');

  const handleGoogleSignIn = async () => {
    try {
      await signInWithGoogle();
      toast({ title: 'Redirecting to Google', status: 'info' });
    } catch (signInError) {
      toast({
        title: 'Google sign-in failed',
        status: 'error',
        description: signInError instanceof Error ? signInError.message : 'Unable to start Google authentication.',
      });
    }
  };

  const handleSignOut = async () => {
    setSigningOut.on();
    try {
      await signOut();
      toast({ title: 'Signed out', status: 'info' });
    } catch (signOutError) {
      toast({
        title: 'Sign-out failed',
        status: 'error',
        description: signOutError instanceof Error ? signOutError.message : 'Unable to sign out right now.',
      });
    } finally {
      setSigningOut.off();
    }
  };

  const handleRetry = async () => {
    setRetrying.on();
    try {
      await refreshProfile();
    } catch (retryError) {
      toast({
        title: 'Unable to refresh profile',
        status: 'error',
        description: retryError instanceof Error ? retryError.message : 'Please try again later.',
      });
    } finally {
      setRetrying.off();
    }
  };

  if (!isConfigured) {
    return (
      <Tooltip label="Online play is disabled until Supabase is configured." hasArrow>
        <Button size="sm" variant="outline" isDisabled>
          Sign in
        </Button>
      </Tooltip>
    );
  }

  if (loading && session) {
    return (
      <Button size="sm" variant="outline" isLoading loadingText="Loading">
        Loading
      </Button>
    );
  }

  if (session && !profile) {
    const retryButton = (
      <Button
        size="sm"
        variant="outline"
        onClick={handleRetry}
        isLoading={loading || retrying}
        loadingText="Loading profile"
        _hover={{ bg: signInHoverBg, transform: 'translateY(-1px)' }}
        _active={{ bg: signInActiveBg }}
      >
        {loading || retrying ? 'Loading profile…' : 'Retry profile sync'}
      </Button>
    );

    return error ? (
      <Tooltip label={error} hasArrow>
        {retryButton}
      </Tooltip>
    ) : (
      retryButton
    );
  }

  if (!profile) {
    const signInButton = (
      <Button
        size="sm"
        bg="white"
        color="gray.800"
        leftIcon={<GoogleIcon boxSize={4} />}
        onClick={handleGoogleSignIn}
        _hover={{ bg: signInHoverBg, transform: 'translateY(-1px)', boxShadow: 'lg' }}
        _active={{ bg: signInActiveBg }}
      >
        Sign in with Google
      </Button>
    );

    return error ? (
      <Tooltip label={error} hasArrow>
        {signInButton}
      </Tooltip>
    ) : (
      signInButton
    );
  }

  const ensuredProfile = profile!;
  const avatarUrl = ensuredProfile.avatar_url
    ?? (typeof session?.user.user_metadata?.avatar_url === 'string' ? session.user.user_metadata.avatar_url : undefined);
  const email = session?.user.email;

  return (
    <Menu placement="bottom-end" closeOnSelect={false} autoSelect={false}>
      <MenuButton
        as={Button}
        size="sm"
        variant="outline"
        px={3}
        py={2}
        _hover={{ bg: signInHoverBg, transform: 'translateY(-1px)' }}
        _active={{ bg: signInActiveBg }}
      >
        <HStack spacing={2} align="center">
          <Avatar size="xs" name={ensuredProfile.display_name} src={avatarUrl} />
          <Text fontSize="sm" fontWeight="semibold">
            {ensuredProfile.display_name}
          </Text>
          <ChevronDownIcon />
        </HStack>
      </MenuButton>
      <MenuList bg={menuBg} borderColor={menuBorder} minW="56" sx={{ '--menu-bg': menuBg }}>
        <Box px={3} py={2} display="flex" flexDir="column" gap={1}>
          <Text fontSize="xs" textTransform="uppercase" color={menuMuted} letterSpacing="wide">
            Signed in
          </Text>
          <Text fontWeight="semibold">{ensuredProfile.display_name}</Text>
          {email && (
            <Text fontSize="sm" color={menuMuted}>
              {email}
            </Text>
          )}
        </Box>
        <MenuDivider borderColor={menuBorder} />
        <MenuItem
          onClick={() => {
            onNavigateToProfile?.();
          }}
          _hover={{ bg: signInHoverBg }}
          closeOnSelect
        >
          <Text>View profile</Text>
        </MenuItem>
        {error && (
          <MenuItem onClick={handleRetry} isDisabled={retrying} _hover={{ bg: signInHoverBg }}>
            <HStack spacing={3} align="center">
              {retrying && <Spinner size="sm" />}
              <Text>{retrying ? 'Refreshing…' : 'Retry profile sync'}</Text>
            </HStack>
          </MenuItem>
        )}
        <MenuItem onClick={handleSignOut} isDisabled={signingOut} _hover={{ bg: signInHoverBg }}>
          <HStack spacing={3} align="center">
            {signingOut && <Spinner size="sm" />}
            <Text>{signingOut ? 'Signing out…' : 'Sign out'}</Text>
          </HStack>
        </MenuItem>
      </MenuList>
    </Menu>
  );
}

export default AuthJourney;
