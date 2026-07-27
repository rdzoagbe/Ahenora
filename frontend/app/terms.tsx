import React from 'react';
import { LegalPage } from '../src/components/LegalPage';

export default function TermsScreen() {
  return (
    <LegalPage
      title="Terms & Support"
      subtitle="Terms of use, acceptable use, support contact, and important limitations for the Household COO app."
      updatedAt="July 2026"
      sections={[
        {
          title: 'About this app',
          body: 'Household COO is available on Google Play. We continuously add and improve functionality; features may change between updates.',
        },
        {
          title: 'Your responsibilities',
          body: [
            'Use the app only for lawful household organization and family coordination.',
            'Do not upload content you do not have the right to store or process.',
            'Do not use the app for emergencies or critical safety decisions.',
            'Review scanned or AI-assisted results before relying on them.',
          ],
        },
        {
          title: 'Subscriptions and payments',
          body: 'Premium subscriptions are billed through Google Play Billing at the price shown before purchase. Subscriptions renew automatically until cancelled in Google Play; cancelling keeps Premium until the end of the paid period. Refunds follow Google Play policy.',
        },
        {
          title: 'Availability',
          body: 'The app and backend may be unavailable during maintenance or infrastructure incidents. We aim to provide a reliable service but do not guarantee uninterrupted availability.',
        },
        {
          title: 'Support',
          body: 'For support, deletion requests, or privacy questions, contact: rolanddzoagbe@gmail.com. Include your Household COO account email and a short description of the issue.',
        },
      ]}
      footer="These terms may be updated as Household COO evolves. Material changes will be announced in the app before they take effect."
    />
  );
}
