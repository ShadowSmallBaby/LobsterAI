import React, { useEffect } from 'react';

import SidebarToggleIcon from '../icons/SidebarToggleIcon';
import WindowTitleBar from './WindowTitleBar';

interface WindowsAppTitleBarProps {
  isOverlayActive?: boolean;
  isSidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
  sidebarToggleLabel?: string;
}

const WindowsAppTitleBar: React.FC<WindowsAppTitleBarProps> = ({
  isOverlayActive = false,
  isSidebarCollapsed = false,
  onToggleSidebar,
  sidebarToggleLabel,
}) => {
  useEffect(() => {
    if (window.electron.platform !== 'win32') return;

    const message = 'Windows app title bar mounted';
    console.debug(`[WindowsAppTitleBar] ${message}`);
    try {
      window.electron?.log?.fromRenderer?.('debug', 'WindowsAppTitleBar', message);
    } catch {
      // Best-effort diagnostic only.
    }
  }, []);

  if (window.electron.platform !== 'win32') {
    return null;
  }

  return (
    <div className="draggable flex h-9 shrink-0 items-center justify-between border-b border-border bg-surface-raised px-3">
      <div className="flex h-full w-[244px] shrink-0 items-center justify-between">
        <div className="flex min-w-0 items-center gap-2">
          <img
            src="logo.png"
            alt=""
            draggable={false}
            className="h-4 w-4 shrink-0"
          />
          <span className="truncate text-sm font-medium text-foreground">
            LobsterAI
          </span>
        </div>
        {onToggleSidebar && (
          <button
            type="button"
            onClick={onToggleSidebar}
            className="non-draggable h-8 w-8 inline-flex items-center justify-center rounded-lg text-secondary hover:bg-surface transition-colors"
            aria-label={sidebarToggleLabel}
            title={sidebarToggleLabel}
          >
            <SidebarToggleIcon className="h-4 w-4" isCollapsed={isSidebarCollapsed} />
          </button>
        )}
      </div>
      <WindowTitleBar inline isOverlayActive={isOverlayActive} />
    </div>
  );
};

export default WindowsAppTitleBar;
