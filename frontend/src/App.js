import "@/index.css";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Landing from "@/pages/Landing";
import Dashboard from "@/pages/Dashboard";
import { Toaster } from "@/components/ui/sonner";
import { SpinPhaseProvider } from "@/lib/SpinPhaseContext";

function App() {
  return (
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
  );
}

export default App;
