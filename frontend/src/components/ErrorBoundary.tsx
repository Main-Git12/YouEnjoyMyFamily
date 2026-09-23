import { Component, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  message: string | null;
}

/**
 * The last line before a white screen.
 *
 * This runs on a display that lives on a kitchen wall — nobody is going to
 * open dev tools, and on an Echo Show there isn't an obvious reload. A
 * render that throws has to end in something a person can read and a button
 * they can press, not a blank rectangle nobody can explain.
 *
 * Still a class component: React has no hook equivalent for catching a
 * render error.
 */
export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { message: null };

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { message: error instanceof Error ? error.message : String(error) };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Goes to the browser console rather than anywhere off-device: this is
    // a family's own screen, and nothing about their day leaves it.
    console.error("YouEnjoyMyFamily crashed while rendering", error, info.componentStack);
  }

  render(): ReactNode {
    const { message } = this.state;
    if (message === null) return this.props.children;

    return (
      <main className="min-h-screen bg-white flex items-center justify-center p-8">
        <div className="bg-white rounded-card shadow-[var(--shadow-card)] border-2 border-olive-100 px-8 py-10 text-center max-w-lg">
          <p className="font-display text-3xl text-olive-700">The screen tripped over something.</p>
          <p className="text-olive-700 mt-3">
            Nothing is lost — today&apos;s chores and gems are safe on the family&apos;s account. Reloading usually
            sorts it out.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-6 font-display bg-olive-600 text-white rounded-full px-8 py-4 text-lg shadow-[var(--shadow-card)] hover:bg-olive-700"
          >
            Reload the screen
          </button>
          <p className="text-xs text-olive-600 mt-6 break-words">{message}</p>
        </div>
      </main>
    );
  }
}
