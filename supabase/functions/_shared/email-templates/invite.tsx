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
  Preview,
  Text,
} from 'npm:@react-email/components@0.0.22'

const LOGO_URL = 'https://gpclaklkaolyzfnooajt.supabase.co/storage/v1/object/public/email-assets/logo.png'

interface InviteEmailProps {
  siteName: string
  siteUrl: string
  confirmationUrl: string
}

export const InviteEmail = ({
  siteName,
  siteUrl,
  confirmationUrl,
}: InviteEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>You've been summoned to Wayfarers of Varneth</Preview>
    <Body style={main}>
      <Container style={container}>
        <Img src={LOGO_URL} alt="Wayfarers of Varneth" width="80" height="80" style={logo} />
        <Heading style={h1}>You've Been Summoned</Heading>
        <Text style={text}>
          A fellow wayfarer has invited you to join the realm of Varneth.
          Click the button below to accept and begin your journey.
        </Text>
        <Button style={button} href={confirmationUrl}>
          Accept Invitation
        </Button>
        <Text style={footer}>
          If you weren't expecting this invitation, you can safely ignore this missive.
        </Text>
      </Container>
    </Body>
  </Html>
)

export default InviteEmail

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
