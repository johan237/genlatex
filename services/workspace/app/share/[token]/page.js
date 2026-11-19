/**
 * Share Link Acceptance Page
 * Handles accepting project shares via secure tokens
 */

'use client';

import { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Text, Box, Card, Flex, Heading, Spinner } from '@radix-ui/themes';
import { EyeOpenIcon, Pencil1Icon } from '@radix-ui/react-icons';

export default function ShareAcceptancePage({ params }) {
  const router = useRouter();
  const resolvedParams = use(params);
  const { token } = resolvedParams;
  const [loading, setLoading] = useState(true);
  const [shareInfo, setShareInfo] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchShareInfo();
  }, [token]);

  async function fetchShareInfo() {
    try {
      const res = await fetch(`/api/shares/${token}`);
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Invalid or expired share link');
        setLoading(false);
        return;
      }

      setShareInfo(data.shareInfo);
      setLoading(false);
    } catch (error) {
      console.error('Error fetching share info:', error);
      setError('Failed to load share link');
      setLoading(false);
    }
  }

  async function handleAcceptShare() {
    try {
      const res = await fetch('/api/auth/session');
      const data = await res.json();

      if (data.user) {
        // User is logged in, accept the share
        const acceptRes = await fetch(`/api/shares/${token}/accept`, {
          method: 'POST'
        });

        if (acceptRes.ok) {
          const acceptData = await acceptRes.json();
          // Redirect to the shared project
          router.push(`/editor/${acceptData.projectId}`);
        } else {
          setError('Failed to accept share. Please try again.');
        }
      } else {
        // User is not logged in, redirect to sign up
        router.push(`/register?share=${token}`);
      }
    } catch (error) {
      console.error('Error accepting share:', error);
      setError('Failed to accept share. Please try again.');
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Flex direction="column" gap="3" align="center">
          <Spinner size="3" />
          <Text size="3" style={{ color: 'var(--gray-11)' }}>
            Loading share information...
          </Text>
        </Flex>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Card style={{ maxWidth: '500px', width: '100%', padding: '32px' }}>
          <Flex direction="column" gap="4">
            <Heading size="5">Share Link Error</Heading>
            <Text size="3" style={{ color: 'var(--red-11)' }}>
              {error}
            </Text>
            <Button
              variant="solid"
              size="3"
              onClick={() => router.push('/')}
              style={{ width: '100%' }}
            >
              Go to Homepage
            </Button>
          </Flex>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-50 dark:bg-gray-900">
      <Card style={{ maxWidth: '600px', width: '100%', padding: '40px' }}>
        <Flex direction="column" gap="6">
          <Flex direction="column" gap="2">
            <Heading size="6">You've been invited to collaborate!</Heading>
            <Text size="3" style={{ color: 'var(--gray-11)' }}>
              You've been invited to collaborate on <strong>"{shareInfo.projectName}"</strong>
            </Text>
          </Flex>

          <Box style={{ 
            padding: '20px', 
            borderRadius: '10px',
            backgroundColor: shareInfo.permission === 'edit' ? 'var(--green-2)' : 'var(--blue-2)',
            border: `2px solid ${shareInfo.permission === 'edit' ? 'var(--green-7)' : 'var(--blue-7)'}`
          }}>
            <Flex direction="column" gap="3">
              <Flex align="center" gap="3">
                {shareInfo.permission === 'edit' ? (
                  <Pencil1Icon width="24" height="24" />
                ) : (
                  <EyeOpenIcon width="24" height="24" />
                )}
                <Text size="4" weight="medium" style={{ color: 'var(--gray-12)' }}>
                  {shareInfo.permission === 'edit' ? 'Can Edit' : 'View Only'}
                </Text>
              </Flex>
              <Text size="2" style={{ color: 'var(--gray-11)' }}>
                {shareInfo.permission === 'edit' 
                  ? 'You will be able to view, edit, and collaborate on this project.'
                  : 'You will be able to view and download this project, but not make changes.'}
              </Text>
            </Flex>
          </Box>

          <Text size="2" style={{ color: 'var(--gray-11)' }}>
            Shared by: <strong>{shareInfo.sharedByName}</strong> ({shareInfo.sharedByEmail})
          </Text>

          <Flex gap="3">
            <Button
              variant="soft"
              size="3"
              onClick={() => router.push('/')}
              style={{ flex: 1 }}
            >
              Cancel
            </Button>
            <Button
              variant="solid"
              size="3"
              onClick={handleAcceptShare}
              style={{ 
                flex: 1,
                backgroundColor: 'var(--accent-9)',
                color: 'white'
              }}
            >
              Accept & Continue
            </Button>
          </Flex>
        </Flex>
      </Card>
    </div>
  );
}

