/// <reference types="npm:@types/react@18.3.1" />

import * as React from 'npm:react@18.3.1'

import {
  Body,
  Container,
  Head,
  Heading,
  Html,
  Img,
  Preview,
  Text,
} from 'npm:@react-email/components@0.0.22'

const LOGO_URL = 'https://gpclaklkaolyzfnooajt.supabase.co/storage/v1/object/public/email-assets/logo.png'

interface ReauthenticationEmailProps {
  token: string
}

export const ReauthenticationEmail = ({ token }: ReauthenticationEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Your verification code for Wayfarers of Varneth</Preview>
    <Body style={main}>
      <Container style={container}>
        <Img src={LOGO_URL} alt="Wayfarers of Varneth" width="80" height="80" style={logo} />
        <Heading style={h1}>Verification Code</Heading>
        <Text style={text}>Use the code below to confirm your identity:</Text>
        <Text style={codeStyle}>{token}</Text>
        <Text style={footer}>
          This code will expire shortly. If you didn't request this, you can
          safely ignore this missive.
        </Text>
      </Container>
    </Body>
  </Html>
)

export default ReauthenticationEmail

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
const codeStyle = {
  fontFamily: "'Cinzel', Courier, monospace",
  fontSize: '28px',
  fontWeight: 'bold' as const,
  color: '#b8860b',
  margin: '0 0 30px',
  letterSpacing: '4px',
}
const footer = { fontSize: '12px', color: '#999999', margin: '30px 0 0', textAlign: 'left' as const }
