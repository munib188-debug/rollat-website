import { createContext, useContext } from "react";
import { useSpinState, useStats } from "@/lib/api";

const SpinPhaseContext = createContext(null);

export function SpinPhaseProvider({ children }) {
  const spinState = useSpinState();
  const stats = useStats();
  return (
    <SpinPhaseContext.Provider value={{ spinState, stats }}>
      {children}
    </SpinPhaseContext.Provider>
  );
}

export function useSpinPhase() {
  return useContext(SpinPhaseContext);
}
