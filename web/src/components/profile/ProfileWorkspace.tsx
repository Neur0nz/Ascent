import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import {
  Alert,
  AlertDescription,
  AlertIcon,
  AlertTitle,
  AspectRatio,
  Avatar,
  Badge,
  Box,
  Button,
  Card,
  CardBody,
  Center,
  Flex,
  FormControl,
  FormErrorMessage,
  FormHelperText,
  FormLabel,
  Heading,
  HStack,
  Input,
  Image as ChakraImage,
  Radio,
  RadioGroup,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  Spinner,
  Slider,
  SliderFilledTrack,
  SliderThumb,
  SliderTrack,
  Stack,
  Switch,
  Text,
  useBoolean,
  useColorModeValue,
  useDisclosure,
  useToast,
} from '@chakra-ui/react';
import GoogleIcon from '@components/auth/GoogleIcon';
import type { SupabaseAuthState } from '@hooks/useSupabaseAuth';
import { generateDisplayName, validateDisplayName } from '@/utils/generateDisplayName';
import { useSurfaceTokens } from '@/theme/useSurfaceTokens';
import { cropImageToFile, type CropArea } from '@/utils/cropImage';
import type { EnginePreference } from '@/types/match';

const MAX_AVATAR_FILE_BYTES = 2 * 1024 * 1024;
const MIN_ZOOM = 1;
const MAX_ZOOM = 3;
const ZOOM_STEP = 0.05;

interface Offset {
  x: number;
  y: number;
}

interface CropMetrics {
  coverScale: number;
  zoomedScale: number;
  scaledWidth: number;
  scaledHeight: number;
  maxOffsetX: number;
  maxOffsetY: number;
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}

function calculateCropMetrics(image: { width: number; height: number }, containerSize: number, zoomValue: number): CropMetrics {
  const minSide = Math.min(image.width, image.height);
  const coverScale = containerSize / minSide;
  const zoomedScale = coverScale * zoomValue;
  const scaledWidth = image.width * zoomedScale;
  const scaledHeight = image.height * zoomedScale;
  const maxOffsetX = Math.max(0, (scaledWidth - containerSize) / 2);
  const maxOffsetY = Math.max(0, (scaledHeight - containerSize) / 2);

  return {
    coverScale,
    zoomedScale,
    scaledWidth,
    scaledHeight,
    maxOffsetX,
    maxOffsetY,
  };
}

interface ProfileWorkspaceProps {
  auth: SupabaseAuthState;
}

function ProfileWorkspace({ auth }: ProfileWorkspaceProps) {
  const {
    profile,
    session,
    loading,
    error,
    isConfigured,
    signInWithGoogle,
    signOut,
    updateDisplayName,
    updateAvatar,
    updateEnginePreference,
    updateCoordinatePreference,
    refreshProfile,
  } = auth;
  const [savingName, setSavingName] = useBoolean(false);
  const [startingGoogle, setStartingGoogle] = useBoolean(false);
  const [signingOut, setSigningOut] = useBoolean(false);
  const [retrying, setRetrying] = useBoolean(false);
  const [savingAvatar, setSavingAvatar] = useBoolean(false);
  const [savingEnginePreference, setSavingEnginePreference] = useBoolean(false);
  const [savingCoordinatePreference, setSavingCoordinatePreference] = useBoolean(false);
  const [displayNameValue, setDisplayNameValue] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [enginePreference, setEnginePreference] = useState<EnginePreference>('python');
  const [showCoordinateLabels, setShowCoordinateLabels] = useState(true);
  const { isOpen: isCropOpen, onOpen: openCrop, onClose: closeCrop } = useDisclosure();
  const [cropImageUrl, setCropImageUrl] = useState<string | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState<Offset>({ x: 0, y: 0 });
  const [imageSize, setImageSize] = useState<{ width: number; height: number } | null>(null);
  const [cropBoxSize, setCropBoxSize] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const cropContainerRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef<{ pointerId: number | null; lastX: number; lastY: number }>({
    pointerId: null,
    lastX: 0,
    lastY: 0,
  });
  const toast = useToast();
  const googleHoverBg = useColorModeValue('gray.100', 'whiteAlpha.300');
  const googleActiveBg = useColorModeValue('gray.200', 'whiteAlpha.200');
  const cropModalBg = useColorModeValue('gray.100', 'gray.900');
  const { cardBg, cardBorder, mutedText, helperText, accentHeading } = useSurfaceTokens();

  useEffect(() => {
    if (profile) {
      setDisplayNameValue(profile.display_name);
      setNameError(null);
    } else {
      setDisplayNameValue('');
      setNameError(null);
    }
  }, [profile]);

  useEffect(() => {
    setEnginePreference(profile?.engine_preference ?? 'python');
  }, [profile?.engine_preference]);

  useEffect(() => {
    setShowCoordinateLabels(profile?.show_coordinate_labels ?? true);
  }, [profile?.show_coordinate_labels]);

  useEffect(() => {
    setAvatarPreview(null);
  }, [profile?.avatar_url]);

  useEffect(() => {
    return () => {
      if (avatarPreview && avatarPreview.startsWith('blob:')) {
        URL.revokeObjectURL(avatarPreview);
      }
    };
  }, [avatarPreview]);

  useEffect(() => {
    return () => {
      if (cropImageUrl) {
        URL.revokeObjectURL(cropImageUrl);
      }
    };
  }, [cropImageUrl]);

  const handleGoogleSignIn = async () => {
    try {
      setStartingGoogle.on();
      await signInWithGoogle();
      toast({ title: 'Redirecting to Google', status: 'info' });
    } catch (oauthError) {
      toast({
        title: 'Google sign-in failed',
        status: 'error',
        description: oauthError instanceof Error ? oauthError.message : 'Unable to start Google sign-in.',
      });
    } finally {
      setStartingGoogle.off();
    }
  };

  const handleGenerateName = () => {
    const suggestion = generateDisplayName(session?.user.email ?? profile?.display_name);
    setDisplayNameValue(suggestion);
    setNameError(null);
  };

  const handleSaveName = async () => {
    const validationError = validateDisplayName(displayNameValue);
    if (validationError) {
      setNameError(validationError);
      return;
    }

    setSavingName.on();
    try {
      await updateDisplayName(displayNameValue);
      toast({ title: 'Display name updated', status: 'success' });
    } catch (updateError) {
      const message = updateError instanceof Error ? updateError.message : 'Unable to update display name.';
      setNameError(message);
      toast({ title: 'Update failed', status: 'error', description: message });
    } finally {
      setSavingName.off();
    }
  };

  const handleSaveEnginePreference = async () => {
    if (!profile || enginePreference === profile.engine_preference) {
      return;
    }
    setSavingEnginePreference.on();
    try {
      await updateEnginePreference(enginePreference);
      toast({
        title: 'Engine preference updated',
        status: 'success',
        description: 'Changes apply the next time the practice board loads.',
      });
    } catch (updateError) {
      const description =
        updateError instanceof Error ? updateError.message : 'Unable to update engine preference.';
      toast({
        title: 'Update failed',
        status: 'error',
        description,
      });
      setEnginePreference(profile.engine_preference);
    } finally {
      setSavingEnginePreference.off();
    }
  };

  const handleSaveCoordinatePreference = async () => {
    if (!profile || showCoordinateLabels === profile.show_coordinate_labels) {
      return;
    }
    setSavingCoordinatePreference.on();
    try {
      await updateCoordinatePreference(showCoordinateLabels);
      toast({
        title: 'Board preference updated',
        status: 'success',
        description: showCoordinateLabels
          ? 'Coordinates will appear on the board edges.'
          : 'Coordinates will stay hidden until you re-enable them.',
      });
    } catch (updateError) {
      const description = updateError instanceof Error ? updateError.message : 'Unable to update board preference.';
      toast({
        title: 'Update failed',
        status: 'error',
        description,
      });
      setShowCoordinateLabels(profile.show_coordinate_labels);
    } finally {
      setSavingCoordinatePreference.off();
    }
  };

  const handleRetry = async () => {
    setRetrying.on();
    try {
      await refreshProfile();
    } catch (retryError) {
      toast({
        title: 'Unable to refresh',
        status: 'error',
        description: retryError instanceof Error ? retryError.message : 'Please try again later.',
      });
    } finally {
      setRetrying.off();
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

  const resetCropState = () => {
    if (cropImageUrl) {
      URL.revokeObjectURL(cropImageUrl);
    }
    setCropImageUrl(null);
    setPendingFile(null);
    setZoom(1);
    setOffset({ x: 0, y: 0 });
    setImageSize(null);
    setCropBoxSize(0);
    setIsDragging(false);
    dragStateRef.current = { pointerId: null, lastX: 0, lastY: 0 };
  };

  useEffect(() => {
    if (!isCropOpen) {
      return;
    }

    if (typeof window === 'undefined') {
      return;
    }

    const globalWindow = window;
    let frame = 0;
    let observer: ResizeObserver | null = null;
    let didAttachWindowResize = false;

    const updateSize = () => {
      const element = cropContainerRef.current;
      if (!element) {
        return;
      }
      const rect = element.getBoundingClientRect();
      if (rect.width > 0) {
        setCropBoxSize(rect.width);
      }
    };

    const ensureElement = () => {
      const element = cropContainerRef.current;
      if (!element) {
        frame = globalWindow.requestAnimationFrame(ensureElement);
        return;
      }
      updateSize();

      if (typeof ResizeObserver !== 'undefined') {
        observer = new ResizeObserver(() => updateSize());
        observer.observe(element);
      } else {
        globalWindow.addEventListener('resize', updateSize);
        didAttachWindowResize = true;
      }
    };

    frame = globalWindow.requestAnimationFrame(ensureElement);

    return () => {
      if (frame) {
        globalWindow.cancelAnimationFrame(frame);
      }
      if (observer) {
        observer.disconnect();
      }
      if (didAttachWindowResize) {
        globalWindow.removeEventListener('resize', updateSize);
      }
    };
  }, [isCropOpen]);

  const cropMetrics = useMemo(() => {
    if (!imageSize || !cropBoxSize) {
      return null;
    }
    return calculateCropMetrics(imageSize, cropBoxSize, zoom);
  }, [imageSize, cropBoxSize, zoom]);

  const handleZoomChange = useCallback(
    (nextZoom: number) => {
      const clampedZoom = clamp(nextZoom, MIN_ZOOM, MAX_ZOOM);
      setZoom(clampedZoom);
      if (!imageSize || !cropBoxSize) {
        return;
      }
      const nextMetrics = calculateCropMetrics(imageSize, cropBoxSize, clampedZoom);
      setOffset((previous) => ({
        x: clamp(previous.x, -nextMetrics.maxOffsetX, nextMetrics.maxOffsetX),
        y: clamp(previous.y, -nextMetrics.maxOffsetY, nextMetrics.maxOffsetY),
      }));
    },
    [imageSize, cropBoxSize]
  );

  useEffect(() => {
    if (!cropMetrics) {
      return;
    }
    setOffset((previous) => {
      const clampedX = clamp(previous.x, -cropMetrics.maxOffsetX, cropMetrics.maxOffsetX);
      const clampedY = clamp(previous.y, -cropMetrics.maxOffsetY, cropMetrics.maxOffsetY);
      if (clampedX === previous.x && clampedY === previous.y) {
        return previous;
      }
      return { x: clampedX, y: clampedY };
    });
  }, [cropMetrics?.maxOffsetX, cropMetrics?.maxOffsetY]);

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!cropImageUrl || savingAvatar || !cropMetrics) {
        return;
      }
      if (event.pointerType === 'mouse' && event.button !== 0) {
        return;
      }
      event.preventDefault();
      const target = event.currentTarget;
      target.setPointerCapture(event.pointerId);
      dragStateRef.current = {
        pointerId: event.pointerId,
        lastX: event.clientX,
        lastY: event.clientY,
      };
      setIsDragging(true);
    },
    [cropImageUrl, savingAvatar, cropMetrics]
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const { pointerId, lastX, lastY } = dragStateRef.current;
      if (pointerId === null || pointerId !== event.pointerId) {
        return;
      }
      if (!cropMetrics || savingAvatar) {
        return;
      }
      event.preventDefault();
      const deltaX = event.clientX - lastX;
      const deltaY = event.clientY - lastY;
      if (deltaX === 0 && deltaY === 0) {
        return;
      }
      dragStateRef.current = {
        pointerId,
        lastX: event.clientX,
        lastY: event.clientY,
      };
      setOffset((previous) => ({
        x: clamp(previous.x + deltaX, -cropMetrics.maxOffsetX, cropMetrics.maxOffsetX),
        y: clamp(previous.y + deltaY, -cropMetrics.maxOffsetY, cropMetrics.maxOffsetY),
      }));
    },
    [cropMetrics, savingAvatar]
  );

  const releasePointer = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragStateRef.current = { pointerId: null, lastX: 0, lastY: 0 };
    setIsDragging(false);
  }, []);

  const handlePointerEnd = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const { pointerId } = dragStateRef.current;
      if (pointerId === null || pointerId !== event.pointerId) {
        return;
      }
      event.preventDefault();
      releasePointer(event);
    },
    [releasePointer]
  );

  const handleChooseAvatar = () => {
    fileInputRef.current?.click();
  };

  const handleAvatarFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    if (!file.type.startsWith('image/')) {
      toast({ title: 'Unsupported file', status: 'error', description: 'Please choose an image file.' });
      event.target.value = '';
      return;
    }

    if (file.size > MAX_AVATAR_FILE_BYTES) {
      toast({ title: 'File too large', status: 'error', description: 'Please choose an image 2 MB or smaller.' });
      event.target.value = '';
      return;
    }

    if (cropImageUrl) {
      URL.revokeObjectURL(cropImageUrl);
    }

    const previewUrl = URL.createObjectURL(file);
    const imageElement = document.createElement('img');
    imageElement.addEventListener('load', () => {
      setPendingFile(file);
      setCropImageUrl(previewUrl);
      setImageSize({ width: imageElement.naturalWidth, height: imageElement.naturalHeight });
      setOffset({ x: 0, y: 0 });
      setZoom(1);
      openCrop();
    });
    imageElement.addEventListener('error', () => {
      URL.revokeObjectURL(previewUrl);
      toast({ title: 'Image load failed', status: 'error', description: 'Unable to preview that image.' });
    });
    imageElement.src = previewUrl;
    event.target.value = '';
  };

  const handleCancelCrop = () => {
    if (savingAvatar) {
      return;
    }
    resetCropState();
    closeCrop();
  };

  const handleConfirmCrop = async () => {
    if (!pendingFile || !cropImageUrl || !imageSize || !cropBoxSize || !cropMetrics) {
      toast({ title: 'Crop incomplete', status: 'error', description: 'Adjust the crop before saving.' });
      return;
    }

    const { zoomedScale, scaledWidth, scaledHeight } = cropMetrics;
    const containerSize = cropBoxSize;
    const imageTopLeftX = (containerSize - scaledWidth) / 2 + offset.x;
    const imageTopLeftY = (containerSize - scaledHeight) / 2 + offset.y;
    const cropSize = containerSize / zoomedScale;

    if (!Number.isFinite(cropSize) || cropSize <= 0) {
      toast({ title: 'Crop unavailable', status: 'error', description: 'Unable to determine crop area for this image.' });
      return;
    }

    const maxCropX = Math.max(0, imageSize.width - cropSize);
    const maxCropY = Math.max(0, imageSize.height - cropSize);
    const cropArea: CropArea = {
      x: clamp(-imageTopLeftX / zoomedScale, 0, maxCropX),
      y: clamp(-imageTopLeftY / zoomedScale, 0, maxCropY),
      width: cropSize,
      height: cropSize,
    };

    setSavingAvatar.on();

    try {
      const croppedFile = await cropImageToFile(cropImageUrl, cropArea, {
        mimeType: 'image/png',
        size: 512,
        fileName: `${pendingFile.name.replace(/\.[^/.]+$/, '')}-cropped.png`,
      });

      if (croppedFile.size > MAX_AVATAR_FILE_BYTES) {
        toast({
          title: 'Image too large',
          status: 'error',
          description: 'Try zooming out slightly so the final image is under 2 MB.',
        });
        return;
      }

      const uploadedUrl = await updateAvatar(croppedFile);
      if (uploadedUrl) {
        setAvatarPreview(uploadedUrl);
      }

      toast({ title: 'Profile picture updated', status: 'success' });
      closeCrop();
      resetCropState();
    } catch (uploadError) {
      const message = uploadError instanceof Error ? uploadError.message : 'Unable to update profile picture.';
      toast({ title: 'Upload failed', status: 'error', description: message });
    } finally {
      setSavingAvatar.off();
    }
  };

  if (loading) {
    return (
      <Center py={20}>
        <Spinner size="lg" />
      </Center>
    );
  }

  if (!isConfigured) {
    return (
      <Alert status="warning" borderRadius="md">
        <AlertIcon />
        <Box>
          <AlertTitle>Supabase not configured</AlertTitle>
          <AlertDescription>
            Online play and authentication are disabled. Follow the setup guide in `docs/setup/supabase.md` to configure Supabase before signing in.
          </AlertDescription>
        </Box>
      </Alert>
    );
  }

  if (error) {
    return (
      <Alert status="error" borderRadius="md" alignItems="flex-start">
        <AlertIcon />
        <Box flex="1">
          <AlertTitle>Authentication issue</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
          <Stack direction={{ base: 'column', sm: 'row' }} spacing={3} mt={4}>
            <Button size="sm" colorScheme="teal" onClick={handleRetry} isLoading={retrying}>
              Try again
            </Button>
            {session && (
              <Button size="sm" variant="outline" onClick={handleSignOut}>
                Sign out
              </Button>
            )}
          </Stack>
        </Box>
      </Alert>
    );
  }

  if (!profile) {
    return (
      <Card bg={cardBg} borderWidth="1px" borderColor={cardBorder} w="100%">
        <CardBody as={Stack} spacing={6} align="center" textAlign="center" py={{ base: 8, md: 10 }}>
          <Stack spacing={2} maxW="lg">
            <Heading size="md">Sign in with Google to play online</Heading>
            <Text color={mutedText}>
              Challenge real opponents, protect your rating, and sync your Santorini journey across every device.
            </Text>
          </Stack>
          <HStack spacing={2} flexWrap="wrap" justify="center">
            <Badge colorScheme="teal" px={3} py={1} borderRadius="full">
              Keep your rating
            </Badge>
            <Badge colorScheme="purple" px={3} py={1} borderRadius="full">
              Save match history
            </Badge>
            <Badge colorScheme="orange" px={3} py={1} borderRadius="full">
              Challenge friends
            </Badge>
          </HStack>
          <Button
            size="lg"
            bg="white"
            color="gray.800"
            leftIcon={<GoogleIcon boxSize={5} />}
            onClick={handleGoogleSignIn}
            isLoading={startingGoogle}
            isDisabled={startingGoogle}
            _hover={{ bg: googleHoverBg, transform: 'translateY(-1px)', boxShadow: '2xl' }}
            _active={{ bg: googleActiveBg }}
          >
            Continue with Google
          </Button>
          <Text fontSize="sm" color={mutedText} maxW="md">
            After connecting, you&rsquo;ll be able to choose a unique display name that other players will see.
          </Text>
        </CardBody>
      </Card>
    );
  }

  const displayNameChanged = Boolean(profile && displayNameValue.trim() !== profile.display_name);
  const enginePreferenceChanged = Boolean(profile && enginePreference !== profile.engine_preference);
  const coordinatePreferenceChanged = Boolean(profile && showCoordinateLabels !== profile.show_coordinate_labels);
  const avatarSrc = avatarPreview
    ?? profile?.avatar_url
    ?? (typeof session?.user.user_metadata?.avatar_url === 'string' ? session.user.user_metadata.avatar_url : undefined);

  return (
    <>
      <Card bg={cardBg} borderWidth="1px" borderColor={cardBorder} w="100%">
        <CardBody as={Stack} spacing={6}>
        <Flex
          justify="space-between"
          align={{ base: 'stretch', md: 'center' }}
          direction={{ base: 'column', md: 'row' }}
          gap={{ base: 4, md: 6 }}
        >
          <HStack spacing={4} align="center">
            <Box position="relative">
              <Avatar size="lg" name={profile.display_name} src={avatarSrc} opacity={savingAvatar ? 0.6 : 1} />
              {savingAvatar && (
                <Center position="absolute" inset={0}>
                  <Spinner size="sm" />
                </Center>
              )}
            </Box>
            <Box>
              <Heading size="sm">{profile.display_name}</Heading>
              {session?.user.email && (
                <Text fontSize="sm" color={mutedText}>
                  {session.user.email}
                </Text>
              )}
              <Text fontSize="sm" color={mutedText}>
                Connected with Google
              </Text>
              <HStack spacing={3} mt={3} align="center">
                <Button
                  size="xs"
                  variant="outline"
                  onClick={handleChooseAvatar}
                  isLoading={savingAvatar}
                  isDisabled={savingAvatar || isCropOpen}
                >
                  Change photo
                </Button>
                <Text fontSize="xs" color={mutedText}>
                  PNG, JPG, or WEBP up to 2MB
                </Text>
              </HStack>
              <HStack spacing={2} mt={3} flexWrap="wrap">
                <Badge colorScheme="teal" variant="subtle" px={2} py={1} borderRadius="md">
                  Rating: {profile.rating}
                </Badge>
                <Badge colorScheme="green" variant="subtle" px={2} py={1} borderRadius="md">
                  Games: {profile.games_played}
                </Badge>
              </HStack>
            </Box>
          </HStack>
          <Input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            display="none"
            onChange={handleAvatarFile}
          />
          <Button
            variant="outline"
            size="sm"
            alignSelf={{ base: 'flex-start', md: 'auto' }}
            onClick={handleSignOut}
            isLoading={signingOut}
            isDisabled={signingOut}
          >
            Sign out
          </Button>
        </Flex>
        <Stack spacing={3}>
          <FormControl isInvalid={Boolean(nameError)}>
            <FormLabel>Display name</FormLabel>
            <Input
              value={displayNameValue}
              onChange={(event) => {
                const next = event.target.value;
                setDisplayNameValue(next);
                setNameError(validateDisplayName(next));
              }}
              placeholder="Choose how other players see you"
            />
            {nameError ? (
              <FormErrorMessage>{nameError}</FormErrorMessage>
            ) : (
              <FormHelperText color={helperText}>Your public username. Shareable across matches.</FormHelperText>
            )}
          </FormControl>
          <HStack spacing={3} align="flex-start">
            <Button colorScheme="teal" onClick={handleSaveName} isDisabled={!displayNameChanged} isLoading={savingName}>
              Save
            </Button>
            <Button variant="outline" onClick={handleGenerateName} isDisabled={savingName}>
              Generate suggestion
            </Button>
          </HStack>
        </Stack>
        <Stack spacing={2}>
          <Heading size="sm" color={accentHeading}>
            Account security
          </Heading>
          <Text fontSize="sm" color={mutedText}>
            You&rsquo;re signed in with Google. If you revoke access, you&rsquo;ll need to reconnect to play online and keep your rating in
            sync across devices.
          </Text>
        </Stack>
      </CardBody>
      </Card>
      <Card bg={cardBg} borderWidth="1px" borderColor={cardBorder} w="100%" mt={{ base: 6, md: 8 }}>
        <CardBody as={Stack} spacing={5}>
          <Stack spacing={1}>
            <Heading size="sm" color={accentHeading}>
              AI engine preference
            </Heading>
            <Text fontSize="sm" color={mutedText}>
              Practice and analysis use the Python engine by default. Switch to the experimental Rust build if you want to
              try the latest work-in-progress.
            </Text>
          </Stack>
          <FormControl>
            <FormLabel>Practice AI runtime</FormLabel>
            <RadioGroup
              value={enginePreference}
              onChange={(next) => setEnginePreference(next === 'rust' ? 'rust' : 'python')}
            >
              <Stack direction={{ base: 'column', md: 'row' }} spacing={6}>
                <Radio value="python">
                  <Stack spacing={0} align="flex-start">
                    <Text fontWeight="medium">Python (Pyodide)</Text>
                    <Text fontSize="xs" color={mutedText}>
                      Stable baseline that mirrors the original AI.
                    </Text>
                  </Stack>
                </Radio>
                <Radio value="rust">
                  <Stack spacing={0} align="flex-start">
                    <Text fontWeight="medium">Rust / WASM</Text>
                    <Text fontSize="xs" color={mutedText}>
                      Faster but currently experimental and may be unstable.
                    </Text>
                  </Stack>
                </Radio>
              </Stack>
            </RadioGroup>
            <FormHelperText color={helperText}>
              Preference syncs across devices and applies the next time Practice or Analysis loads.
            </FormHelperText>
          </FormControl>
          <Button
            alignSelf="flex-start"
            colorScheme="teal"
            onClick={handleSaveEnginePreference}
            isDisabled={!enginePreferenceChanged || savingEnginePreference}
            isLoading={savingEnginePreference}
          >
            Save preference
          </Button>
        </CardBody>
      </Card>
      <Card bg={cardBg} borderWidth="1px" borderColor={cardBorder} w="100%" mt={{ base: 6, md: 8 }}>
        <CardBody as={Stack} spacing={5}>
          <Stack spacing={1}>
            <Heading size="sm" color={accentHeading}>
              Board coordinates
            </Heading>
            <Text fontSize="sm" color={mutedText}>
              Show file and rank letters on the Santorini board so it&rsquo;s easier to describe moves to your opponent.
            </Text>
          </Stack>
          <FormControl display="flex" alignItems="center">
            <FormLabel htmlFor="coordinate-labels-toggle" mb="0">
              Show coordinate overlays
            </FormLabel>
            <Switch
              id="coordinate-labels-toggle"
              isChecked={showCoordinateLabels}
              onChange={(event) => setShowCoordinateLabels(event.target.checked)}
              colorScheme="teal"
            />
          </FormControl>
          <Text fontSize="xs" color={mutedText}>
            This preference syncs across devices and updates any board you view once saved.
          </Text>
          <Button
            alignSelf="flex-start"
            colorScheme="teal"
            onClick={handleSaveCoordinatePreference}
            isDisabled={!coordinatePreferenceChanged || savingCoordinatePreference}
            isLoading={savingCoordinatePreference}
          >
            Save board setting
          </Button>
        </CardBody>
      </Card>
      <Modal isOpen={isCropOpen} onClose={handleCancelCrop} size="lg" isCentered>
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>Adjust your profile picture</ModalHeader>
          <ModalCloseButton isDisabled={savingAvatar} />
          <ModalBody>
            <AspectRatio ratio={1} w="100%">
              <Box
                ref={cropContainerRef}
                position="relative"
                bg={cropModalBg}
                borderRadius="xl"
                overflow="hidden"
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerEnd}
                onPointerCancel={handlePointerEnd}
                onPointerLeave={(event) => {
                  if (isDragging) {
                    handlePointerEnd(event);
                  }
                }}
                cursor={isDragging ? 'grabbing' : 'grab'}
                style={{ touchAction: 'none' }}
              >
                {cropImageUrl ? (
                  <>
                    {cropMetrics ? (
                      <ChakraImage
                        src={cropImageUrl}
                        alt="Profile being cropped"
                        draggable={false}
                        pointerEvents="none"
                        position="absolute"
                        top="50%"
                        left="50%"
                        maxW="none"
                        maxH="none"
                        style={{
                          width: `${cropMetrics.scaledWidth}px`,
                          height: `${cropMetrics.scaledHeight}px`,
                          transform: `translate(-50%, -50%) translate(${offset.x}px, ${offset.y}px)`,
                          userSelect: 'none',
                          touchAction: 'none',
                        }}
                      />
                    ) : (
                      <Center h="100%">
                        <Spinner size="sm" />
                      </Center>
                    )}
                    <Box
                      pointerEvents="none"
                      position="absolute"
                      inset={0}
                      borderWidth="2px"
                      borderStyle="solid"
                      borderColor="whiteAlpha.700"
                      borderRadius="xl"
                    />
                  </>
                ) : (
                  <Center h="100%">
                    <Spinner size="sm" />
                  </Center>
                )}
              </Box>
            </AspectRatio>
            <Stack spacing={3} mt={6}>
              <Text fontSize="sm" color={mutedText}>
                Drag the image to reposition it and use the slider to zoom.
              </Text>
              <Slider
                value={zoom}
                min={MIN_ZOOM}
                max={MAX_ZOOM}
                step={ZOOM_STEP}
                onChange={handleZoomChange}
                isDisabled={savingAvatar}
                aria-label="Zoom level"
              >
                <SliderTrack>
                  <SliderFilledTrack />
                </SliderTrack>
                <SliderThumb />
              </Slider>
            </Stack>
          </ModalBody>
          <ModalFooter>
            <Button variant="ghost" mr={3} onClick={handleCancelCrop} isDisabled={savingAvatar}>
              Cancel
            </Button>
            <Button colorScheme="teal" onClick={handleConfirmCrop} isLoading={savingAvatar} loadingText="Saving">
              Save
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  );
}

export default ProfileWorkspace;
