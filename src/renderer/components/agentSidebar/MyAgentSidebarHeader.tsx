import { PlusIcon } from '@heroicons/react/24/outline';
import React, { useEffect, useRef, useState } from 'react';

import { i18nService } from '../../services/i18n';

interface MyAgentSidebarHeaderProps {
  canCreateTask: boolean;
  onCreateAgent: () => void;
  onCreateFromTemplate: () => void;
  onCreateTask: () => void;
}

const MyAgentSidebarHeader: React.FC<MyAgentSidebarHeaderProps> = ({
  canCreateTask,
  onCreateAgent,
  onCreateFromTemplate,
  onCreateTask,
}) => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isMenuOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!menuRef.current?.contains(target) && !buttonRef.current?.contains(target)) {
        setIsMenuOpen(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isMenuOpen]);

  const closeAndRun = (action: () => void) => {
    setIsMenuOpen(false);
    action();
  };

  return (
    <div className="relative flex h-10 items-center justify-between px-1.5">
      <h2 className="min-w-0 truncate text-sm font-medium text-secondary/70">
        {i18nService.t('myAgents')}
      </h2>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setIsMenuOpen((value) => !value)}
        className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-secondary transition-colors hover:bg-surface hover:text-foreground"
        aria-label={i18nService.t('createAgent')}
      >
        <PlusIcon className="h-4 w-4" />
      </button>

      {isMenuOpen && (
        <div
          ref={menuRef}
          className="absolute right-2 top-9 z-40 min-w-[158px] overflow-hidden rounded-xl border border-border bg-surface shadow-lg"
          role="menu"
        >
          <button
            type="button"
            onClick={() => closeAndRun(onCreateAgent)}
            className="w-full px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-surface-raised"
            role="menuitem"
          >
            {i18nService.t('createNewAgent')}
          </button>
          <button
            type="button"
            onClick={() => closeAndRun(onCreateFromTemplate)}
            className="w-full px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-surface-raised"
            role="menuitem"
          >
            {i18nService.t('choosePreset')}
          </button>
          {canCreateTask && (
            <button
              type="button"
              onClick={() => closeAndRun(onCreateTask)}
              className="w-full px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-surface-raised"
              role="menuitem"
            >
              {i18nService.t('myAgentSidebarNewTask')}
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default MyAgentSidebarHeader;
