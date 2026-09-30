import { useCallback, useState } from "react";
import Dashboard from "./components/Dashboard";
import LinkDevice from "./components/LinkDevice";
import { isDeviceLinked, linkDevice, unlinkDevice } from "./lib/familyKey";

export default function App() {
  const [linked, setLinked] = useState(isDeviceLinked);
  const [signedOut, setSignedOut] = useState(false);

  const handleLink = useCallback((familyId: string, apiKey: string) => {
    linkDevice(familyId, apiKey);
    setSignedOut(false);
    setLinked(true);
  }, []);

  // The dashboard raises this when the backend rejects the key outright.
  // A rotated or revoked key should send the screen back to setup rather
  // than leaving it looping on an error it can do nothing about.
  const handleSignedOut = useCallback(() => {
    unlinkDevice();
    setSignedOut(true);
    setLinked(false);
  }, []);

  if (!linked) return <LinkDevice onLink={handleLink} signedOut={signedOut} />;
  return <Dashboard onSignedOut={handleSignedOut} />;
}
