'use client';

import React from 'react';
import { SessionProvider as NextAuthSessionProvider } from "next-auth/react"

export function Providers({ children }: { children: React.ReactNode }) {
  return <NextAuthSessionProvider>{children}</NextAuthSessionProvider>;
}