import "@/index.css";
import { Component, lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Landing from "@/pages/Landing";
import { Toaster } from "@/components/ui/sonner";

const Dashboard = lazy(() => import("@/pages/Dashboard"));
const DevAdmin = lazy(() => import("@/pages/DevAdmin"));
import { SpinPhaseProvider } from "@/lib/SpinPhaseContext";
import SolanaWalletProvider from "@/lib/SolanaWalletProvider";
import { AuthProvider } from "@/lib/AuthContext";

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 40, fontFamily: "monospace", color: "#FFD700", background: "#0A0D0B", minHeight: "100vh" }}>
          <h2 style={{ color: "#FF3366" }}>Render Error</h2>
          <pre style={{ color: "#fff", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
            {this.state.error.toString()}
            {"\n\n"}
            {this.state.error.stack}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}

function App() {
  return (
    <ErrorBoundary>
      <SolanaWalletProvider>
        <AuthProvider>
          <SpinPhaseProvider>
            <div className="App font-sans bg-obsidian-950 text-white min-h-screen">
              <BrowserRouter>
                <Suspense fallback={<div className="min-h-screen bg-obsidian-950" />}>
                  <Routes>
                    <Route path="/" element={<Landing />} />
                    <Route path="/dashboard" element={<Dashboard />} />
                    <Route path="/dev" element={<DevAdmin />} />
                  </Routes>
                </Suspense>
              </BrowserRouter>
              <Toaster richColors position="top-center" />
            </div>
          </SpinPhaseProvider>
        </AuthProvider>
      </SolanaWalletProvider>
    </ErrorBoundary>
  );
}

export default App;
