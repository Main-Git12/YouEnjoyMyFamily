import { useCallback, useEffect, useState } from "react";
import Dashboard from "./components/Dashboard";
import LinkDevice from "./components/LinkDevice";
import { isDeviceLinked, linkDevice, unlinkDevice } from "./lib/familyKey";
import { isAlexaSurface, linkFromAlexa } from "./lib/alexaSurface";

export default function App() {
  const [linked, setLinked] = useState(isDeviceLinked);
  const [signedOut, setSignedOut] = useState(false);
  /**
   * On an Echo Show the credentials arrive from the skill a moment after the
   * page loads, so the first render genuinely does not yet know whether this
   * screen is linked. Showing the "enter your family key" form for that
   * moment and then yanking it away is worse than showing nothing: on a wall
   * screen it reads as the app asking a question and then changing its mind.
   */
  const [awaitingAlexa, setAwaitingAlexa] = useState(() => !isDeviceLinked() && isAlexaSurface());

  useEffect(() => {
    if (!awaitingAlexa) return;
    let superseded = false;
    void linkFromAlexa().then((outcome) => {
      if (superseded) return;
      if (outcome === "linked") setLinked(true);
      // "partial" and "unavailable" both fall through to the linking screen —
      // which, after a partial, already knows the family id.
      setAwaitingAlexa(false);
    });
    return () => {
      superseded = true;
    };
  }, [awaitingAlexa]);

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

  if (awaitingAlexa) {
    return (
      <main className="min-h-screen grid place-items-center bg-sand-50">
        <p className="text-olive-700">Opening your family screen…</p>
      </main>
    );
  }
  if (!linked) return <LinkDevice onLink={handleLink} signedOut={signedOut} />;
  return <Dashboard onSignedOut={handleSignedOut} />;
}
