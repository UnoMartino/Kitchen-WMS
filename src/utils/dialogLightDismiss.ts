import { useEffect, RefObject } from 'react';
import { InventoryItem } from '../types';

export function useDialogModal(
  dialogRef: RefObject<HTMLDialogElement | null>,
  isOpen: boolean,
  onClose: () => void
) {
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (isOpen && !dialog.open) {
      dialog.showModal();
    } else if (!isOpen && dialog.open) {
      dialog.close();
    }
  }, [isOpen, dialogRef]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const handleNativeClose = () => {
      onClose();
    };
    dialog.addEventListener('close', handleNativeClose);

    // Fallback for browsers without native <dialog closedby="any"> support
    let handleBackdropClick: ((event: MouseEvent) => void) | null = null;
    if (!('closedBy' in HTMLDialogElement.prototype)) {
      handleBackdropClick = (event: MouseEvent) => {
        if (event.target !== dialog) return;
        const rect = dialog.getBoundingClientRect();
        const isDialogContent =
          rect.top <= event.clientY &&
          event.clientY <= rect.top + rect.height &&
          rect.left <= event.clientX &&
          event.clientX <= rect.left + rect.width;
        if (isDialogContent) return;
        dialog.close();
      };
      dialog.addEventListener('click', handleBackdropClick);
    }

    return () => {
      dialog.removeEventListener('close', handleNativeClose);
      if (handleBackdropClick) {
        dialog.removeEventListener('click', handleBackdropClick);
      }
    };
  }, [dialogRef, onClose]);
}

export function formatDatePl(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  const parts = String(dateStr).slice(0, 10).split('-');
  if (parts.length !== 3) return String(dateStr);
  return `${parts[2]}.${parts[1]}.${parts[0]}`;
}

export function getExpiryBadgeInfo(item: InventoryItem): {
  cls: string;
  marker: string;
  text: string;
} {
  const d = item.days_remaining;
  if (d === null || d === undefined) {
    return {
      cls: 'pill-none',
      marker: '[—]',
      text: 'Brak daty'
    };
  }
  if (d < 0) {
    const abs = Math.abs(d);
    return {
      cls: 'pill-expired',
      marker: '[!]',
      text: `Po terminie (${abs} ${abs === 1 ? 'dzień' : 'dni'})`
    };
  }
  if (d === 0) {
    return {
      cls: 'pill-today',
      marker: '[!]',
      text: 'Wygasa dzisiaj'
    };
  }
  if (d === 1) {
    return {
      cls: 'pill-urgent',
      marker: '[*]',
      text: 'Wygasa jutro (1 dzień)'
    };
  }
  if (d <= 3) {
    return {
      cls: 'pill-urgent',
      marker: '[*]',
      text: `Za ${d} dni (${formatDatePl(item.effective_expiry_date)})`
    };
  }
  if (d <= 7) {
    return {
      cls: 'pill-soon',
      marker: '[*]',
      text: `Za ${d} dni (${formatDatePl(item.effective_expiry_date)})`
    };
  }
  return {
    cls: 'pill-ok',
    marker: '[OK]',
    text: `${formatDatePl(item.effective_expiry_date)} (${d} dni)`
  };
}

