/// <reference types="npm:@types/react@18.3.1" />

import * as React from 'npm:react@18.3.1'

import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Img,
  Link,
  Preview,
  Text,
} from 'npm:@react-email/components@0.0.22'

const LOGO_URL = 'https://gpclaklkaolyzfnooajt.supabase.co/storage/v1/object/public/email-assets/logo.png'

interface EmailChangeEmailProps {
  siteName: string
  email: string
  newEmail: string
  confirmationUrl: string
}

export const EmailChangeEmail = ({
  siteName,
  email,
  newEmail,
  confirmationUrl,
}: EmailChangeEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Confirm your email change for Wayfarers of Varneth</Preview>
    <Body style={main}>
      <Container style={container}>
        <Img src={LOGO_URL} alt="Wayfarers of Varneth" width="80" height="80" style={logo} />
        <Heading style={h1}>Confirm Email Change</Heading>
        <Text style={text}>
          You requested to change your email from{' '}
          <Link href={`mailto:${email}`} style={link}>{email}</Link>{' '}
          to{' '}
          <Link href={`mailto:${newEmail}`} style={link}>{newEmail}</Link>.
        </Text>
        <Text style={text}>
          Click the button below to confirm this change:
        </Text>
        <Button style={button} href={confirmationUrl}>
          Confirm Email Change
        </Button>
        <Text style={footer}>
          If you didn't request this change, please secure your account immediately.
        </Text>
      </Container>
    </Body>
  </Html>
)

export default EmailChangeEmail

const main = { backgroundColor: '#ffffff', fontFamily: "'Crimson Text', Georgia, serif" }
const container = { padding: '20px 25px', textAlign: 'center' as const }
const logo = { margin: '0 auto 16px', display: 'block' }
const h1 = {
  fontSize: '24px',
  fontWeight: 'bold' as const,
  fontFamily: "'Cinzel', Georgia, serif",
  color: '#1a1408',
  margin: '0 0 20px',
}
const text = {
  fontSize: '15px',
  color: '#5a5040',
  lineHeight: '1.6',
  margin: '0 0 25px',
  textAlign: 'left' as const,
}
const link = { color: '#b8860b', textDecoration: 'underline' }
const button = {
  backgroundColor: '#b8860b',
  color: '#ffffff',
  fontSize: '15px',
  fontFamily: "'Cinzel', Georgia, serif",
  fontWeight: 'bold' as const,
  borderRadius: '6px',
  padding: '14px 28px',
  textDecoration: 'none',
}
const footer = { fontSize: '12px', color: '#999999', margin: '30px 0 0', textAlign: 'left' as const }
