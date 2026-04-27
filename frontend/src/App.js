import "@/index.css";
import { Component } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Landing from "@/pages/Landing";
import Dashboard from "@/pages/Dashboard";
import { Toaster } from "@/components/ui/sonner";
import { SpinPhaseProvider } from "@/lib/SpinPhaseContext";

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
      <SpinPhaseProvider>
        <div className="App font-sans bg-obsidian-950 text-white min-h-screen">
          <BrowserRouter>
            <Routes>
              <Route path="/" element={<Landing />} />
              <Route path="/dashboard" element={<Dashboard />} />
            </Routes>
          </BrowserRouter>
          <Toaster richColors position="top-center" />
        </div>
      </SpinPhaseProvider>
    </ErrorBoundary>
  );
}

export default App;
