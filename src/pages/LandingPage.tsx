import * as React from 'react';
import Header from '../components/Header';
import Toast from '../components/ui/Toast';
import { LOGO_COLOR_BASE64 } from '../constants';
import HeroSection from '../components/landing/HeroSection';
import ValueProposition from '../components/landing/ValueProposition';
import DiagnosisFlow from '../components/landing/DiagnosisFlow';
import CoreFeatures from '../components/landing/CoreFeatures';
import PromisesSection from '../components/landing/PromisesSection';
import ContactSection from '../components/landing/ContactSection';
import FaqSection from '../components/landing/FaqSection';
import Footer from '../components/landing/Footer';

const LandingPage = () => {
  const [toastMessage, setToastMessage] = React.useState<string | null>(null);

  return (
    <div className="min-h-screen bg-slate-800 text-slate-50 font-sans">
      {toastMessage && <Toast message={toastMessage} type="info" onClose={() => setToastMessage(null)} />}
      <Header logoUrl={LOGO_COLOR_BASE64} />

      <HeroSection />
      <ValueProposition />
      <DiagnosisFlow />
      <CoreFeatures />
      <PromisesSection />
      <ContactSection />
      <FaqSection />
      <Footer />
    </div>
  );
};

export default LandingPage;