import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ClerkProvider } from '@clerk/react';
import { shadcn } from '@clerk/ui/themes';
import App from './App.js';
import './index.css';
import '@clerk/ui/themes/shadcn.css';
import { TooltipProvider } from '@/components/ui/tooltip';

const clerkPublishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

if (!clerkPublishableKey) {
  throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY');
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ClerkProvider publishableKey={clerkPublishableKey} appearance={{ theme: shadcn }}>
      <TooltipProvider>
        <App />
      </TooltipProvider>
    </ClerkProvider>
  </StrictMode>,
);
