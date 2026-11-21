import React from 'react';
import { WifiOff } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useOnlineStatus } from '../../hooks/usePWAInstall';

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();

  return (
    <AnimatePresence>
      {!isOnline && (
        <motion.div
          role="status"
          aria-live="polite"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 12 }}
          transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
          className="fixed bottom-20 lg:bottom-4 left-4 right-4 sm:right-auto z-50 flex items-center gap-2 rounded-xl bg-[#0F1F3D] border border-[#B8923A]/40 px-3.5 py-2.5 text-xs font-medium text-white shadow-lg"
        >
          <WifiOff className="w-3.5 h-3.5 shrink-0 text-[#DFC27D]" />
          <span>Offline Mode — Showing cached data until connection returns.</span>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
