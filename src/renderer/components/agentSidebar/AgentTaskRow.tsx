import { ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import React, { useEffect, useRef, useState } from 'react';

import { i18nService } from '../../services/i18n';
import Modal from '../common/Modal';
import EllipsisHorizontalIcon from '../icons/EllipsisHorizontalIcon';
import ListChecksIcon from '../icons/ListChecksIcon';
import PencilSquareIcon from '../icons/PencilSquareIcon';
import TrashIcon from '../icons/TrashIcon';
import { AgentSidebarIndicator } from './constants';
import { formatAgentTaskRelativeTime } from './time';
import type { AgentSidebarTaskNode } from './types';

interface AgentTaskRowProps {
  task: AgentSidebarTaskNode;
  isBatchMode: boolean;
  isSelected: boolean;
  showBatchOption?: boolean;
  onSelect: () => void;
  onDelete: () => Promise<void>;
  onTogglePin: (pinned: boolean) => Promise<void>;
  onRename: (title: string) => Promise<void>;
  onToggleSelection: () => void;
  onEnterBatchMode: () => void;
}

const PushPinIcon: React.FC<React.SVGProps<SVGSVGElement> & { slashed?: boolean }> = ({
  slashed,
  ...props
}) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}
  >
    <g transform="rotate(45 12 12)">
      <path d="M9 3h6l-1 5 2 2v2H8v-2l2-2-1-5z" />
      <path d="M12 12v9" />
    </g>
    {slashed && <path d="M5 5L19 19" />}
  </svg>
);

const AgentTaskRow: React.FC<AgentTaskRowProps> = ({
  task,
  isBatchMode,
  isSelected,
  showBatchOption = false,
  onSelect,
  onDelete,
  onTogglePin,
  onRename,
  onToggleSelection,
  onEnterBatchMode,
}) => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [showConfirmDelete, setShowConfirmDelete] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(task.title);
  const menuRef = useRef<HTMLDivElement>(null);
  const actionButtonRef = useRef<HTMLButtonElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isRenaming) {
      setRenameValue(task.title);
    }
  }, [isRenaming, task.title]);

  useEffect(() => {
    if (!isMenuOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!menuRef.current?.contains(target) && !actionButtonRef.current?.contains(target)) {
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

  useEffect(() => {
    if (!isRenaming) return;
    requestAnimationFrame(() => {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    });
  }, [isRenaming]);

  const handleRowClick = () => {
    if (isRenaming) return;
    if (isBatchMode) {
      onToggleSelection();
      return;
    }
    onSelect();
  };

  const handleRenameSave = async () => {
    const nextTitle = renameValue.trim();
    setIsRenaming(false);
    if (nextTitle && nextTitle !== task.title) {
      await onRename(nextTitle);
    }
  };

  const handleRenameCancel = () => {
    setRenameValue(task.title);
    setIsRenaming(false);
  };

  const indicatorLabel = task.indicator === AgentSidebarIndicator.Running
    ? i18nService.t('myAgentSidebarRunning')
    : i18nService.t('myAgentSidebarUnreadResult');
  const menuItemClassName =
    'flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[13px] text-foreground transition-colors hover:bg-black/[0.03] dark:hover:bg-white/[0.04]';
  const dangerMenuItemClassName =
    'flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[13px] text-red-500 transition-colors hover:bg-red-500/10';
  const menuIconClassName = 'h-3.5 w-3.5';
  const relativeTime = formatAgentTaskRelativeTime(task.updatedAt);

  return (
    <div
      className={`group relative -ml-[6px] flex h-[30px] w-[calc(100%+12px)] cursor-pointer items-center gap-2 rounded-md ${
        isBatchMode ? 'pl-4' : 'pl-[38px]'
      } pr-2.5 text-[13px] transition-colors ${
        task.isSelected
          ? 'bg-black/[0.06] text-foreground dark:bg-white/[0.07]'
          : 'text-secondary hover:bg-black/[0.03] hover:text-foreground dark:hover:bg-white/[0.04]'
      }`}
      onClick={handleRowClick}
      role="treeitem"
      aria-level={2}
      aria-selected={task.isSelected}
    >
      {isBatchMode && (
        <input
          type="checkbox"
          checked={isSelected}
          onChange={(event) => {
            event.stopPropagation();
            onToggleSelection();
          }}
          onClick={(event) => event.stopPropagation()}
          className="h-3.5 w-3.5 shrink-0 rounded border-gray-300 accent-primary"
        />
      )}

      {isRenaming ? (
        <input
          ref={renameInputRef}
          value={renameValue}
          onChange={(event) => setRenameValue(event.target.value)}
          onClick={(event) => event.stopPropagation()}
          onBlur={() => void handleRenameSave()}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              void handleRenameSave();
            }
            if (event.key === 'Escape') {
              handleRenameCancel();
            }
          }}
          className="min-w-0 flex-1 rounded-md border border-border bg-background px-1.5 py-0.5 text-[13px] text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        />
      ) : (
        <>
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
            {task.title}
          </span>
          {task.indicator === AgentSidebarIndicator.Running && (
            <span
              className="inline-flex h-3 w-3 shrink-0 items-center justify-center"
              title={indicatorLabel}
              aria-label={indicatorLabel}
            >
              <svg className="h-3 w-3 animate-spin text-primary" viewBox="0 0 24 24" fill="none">
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                />
              </svg>
            </span>
          )}
          {task.indicator === AgentSidebarIndicator.CompletedUnread && (
            <span
              className="h-[7px] w-[7px] shrink-0 rounded-full bg-emerald-500"
              title={indicatorLabel}
              aria-label={indicatorLabel}
            />
          )}
          <span
            className={`shrink-0 whitespace-nowrap text-[13px] font-medium text-secondary/70 transition-opacity ${
              task.pinned ? 'opacity-0' : 'group-hover:opacity-0'
            }`}
            title={relativeTime.full}
          >
            {relativeTime.compact}
          </span>
        </>
      )}

      {!isBatchMode && !isRenaming && (
        <button
          ref={actionButtonRef}
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            setIsMenuOpen((value) => !value);
          }}
          className={`absolute right-1 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-secondary/60 transition-opacity hover:text-foreground ${
            task.pinned ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
          }`}
          aria-label={i18nService.t('coworkSessionActions')}
        >
          {task.pinned ? (
            <span className="relative block h-4 w-4">
              <PushPinIcon className="h-4 w-4 transition-opacity group-hover:opacity-0" />
              <EllipsisHorizontalIcon className="absolute inset-0 h-4 w-4 opacity-0 transition-opacity group-hover:opacity-100" />
            </span>
          ) : (
            <EllipsisHorizontalIcon className="h-4 w-4" />
          )}
        </button>
      )}

      {isMenuOpen && (
        <div
          ref={menuRef}
          className="absolute right-0 top-7 z-40 min-w-[152px] overflow-hidden rounded-lg border border-border bg-surface shadow-lg"
          role="menu"
        >
          {showBatchOption && (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                setIsMenuOpen(false);
                onEnterBatchMode();
              }}
              className={menuItemClassName}
              role="menuitem"
            >
              <ListChecksIcon className={menuIconClassName} />
              {i18nService.t('batchOperations')}
            </button>
          )}
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              setIsMenuOpen(false);
              setIsRenaming(true);
            }}
            className={menuItemClassName}
            role="menuitem"
          >
            <PencilSquareIcon className={menuIconClassName} />
            {i18nService.t('renameConversation')}
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              setIsMenuOpen(false);
              void onTogglePin(!task.pinned);
            }}
            className={menuItemClassName}
            role="menuitem"
          >
            <PushPinIcon slashed={task.pinned} className={menuIconClassName} />
            {task.pinned ? i18nService.t('coworkUnpinSession') : i18nService.t('coworkPinSession')}
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              setIsMenuOpen(false);
              setShowConfirmDelete(true);
            }}
            className={dangerMenuItemClassName}
            role="menuitem"
          >
            <TrashIcon className={menuIconClassName} />
            {i18nService.t('deleteSession')}
          </button>
        </div>
      )}

      {showConfirmDelete && (
        <Modal
          onClose={() => setShowConfirmDelete(false)}
          className="w-full max-w-sm mx-4 bg-surface rounded-2xl shadow-xl overflow-hidden"
        >
          <div className="flex items-center gap-3 px-5 py-4">
            <div className="p-2 rounded-full bg-red-100 dark:bg-red-900/30">
              <ExclamationTriangleIcon className="h-5 w-5 text-red-600 dark:text-red-500" />
            </div>
            <h2 className="text-base font-semibold text-foreground">
              {i18nService.t('deleteTaskConfirmTitle')}
            </h2>
          </div>
          <div className="px-5 pb-4">
            <p className="text-sm text-secondary">
              {i18nService.t('deleteTaskConfirmMessage')}
            </p>
          </div>
          <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-border">
            <button
              type="button"
              onClick={() => setShowConfirmDelete(false)}
              className="px-4 py-2 text-sm font-medium rounded-lg text-secondary hover:bg-surface-raised transition-colors"
            >
              {i18nService.t('cancel')}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowConfirmDelete(false);
                void onDelete();
              }}
              className="px-4 py-2 text-sm font-medium rounded-lg bg-red-500 text-white transition-colors hover:bg-red-600"
            >
              {i18nService.t('deleteSession')}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
};

export default AgentTaskRow;
