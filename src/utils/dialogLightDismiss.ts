import { useEffect, useRef, RefObject } from 'react';
import { InventoryItem } from '../types';

const modalStack: HTMLDialogElement[] = [];

function pushModalToStack(dialog: HTMLDialogElement) {
  const existingIdx = modalStack.indexOf(dialog);
  if (existingIdx !== -1) {
    modalStack.splice(existingIdx, 1);
  }
  modalStack.push(dialog);
}

function removeModalFromStack(dialog: HTMLDialogElement) {
  const idx = modalStack.indexOf(dialog);
  if (idx !== -1) {
    modalStack.splice(idx, 1);
  }
}

function isTopModal(dialog: HTMLDialogElement): boolean {
  for (let i = modalStack.length - 1; i >= 0; i--) {
    const candidate = modalStack[i];
    if (!candidate.isConnected || !candidate.open) {
      modalStack.splice(i, 1);
      continue;
    }
    return candidate === dialog;
  }
  return true;
}

let supportsDisplayTransition: boolean | undefined;

function canTransitionDisplay(): boolean {
  if (supportsDisplayTransition !== undefined) return supportsDisplayTransition;
  if (!window.CSS?.supports?.('transition-behavior', 'allow-discrete') || !document.body) {
    supportsDisplayTransition = false;
    return false;
  }
  const probe = document.createElement('div');
  probe.style.cssText = 'transition: display 1s allow-discrete !important; display: block;';
  document.body.appendChild(probe);
  getComputedStyle(probe).display;
  probe.style.display = 'none';
  supportsDisplayTransition = getComputedStyle(probe).display === 'block';
  probe.remove();
  return supportsDisplayTransition;
}

function supportsTopLayerExit(): boolean {
  return Boolean(window.CSS?.supports?.('overlay', 'auto') && canTransitionDisplay());
}

/**
 * Smoothly animates a modal <dialog> out of the top layer in browsers
 * without native `overlay` + discrete `display` exit transitions (e.g. Safari/Firefox).
 */
export async function closeDialogAnimated(dialog: HTMLDialogElement): Promise<void> {
  if (!dialog.open || dialog.hasAttribute('data-closing')) return;

  if (!supportsTopLayerExit()) {
    dialog.setAttribute('data-closing', '');
    // Flush computed styles so getAnimations() sees the newly started exit transitions
    getComputedStyle(dialog).opacity;
    const animations = dialog.getAnimations({ subtree: true });
    if (animations.length > 0) {
      await Promise.race([
        Promise.allSettled(animations.map((a) => a.finished)),
        new Promise((resolve) => window.setTimeout(resolve, 600)),
      ]);
    }
    if (!dialog.hasAttribute('data-closing')) return;
    dialog.removeAttribute('data-closing');
  }

  if (dialog.open) {
    dialog.close();
  }
}

export function useDialogModal(
  dialogRef: RefObject<HTMLDialogElement | null>,
  isOpen: boolean,
  onClose: () => void
) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (isOpen) {
      dialog.removeAttribute('data-closing');
      pushModalToStack(dialog);
      if (!dialog.open) {
        dialog.showModal();
      }
    } else if (dialog.open) {
      void closeDialogAnimated(dialog);
    } else {
      removeModalFromStack(dialog);
    }
  }, [isOpen, dialogRef]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const handleNativeClose = () => {
      dialog.removeAttribute('data-closing');
      removeModalFromStack(dialog);
      onCloseRef.current();
    };

    const handleCancel = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!isTopModal(dialog) || dialog.hasAttribute('data-closing')) return;
      void closeDialogAnimated(dialog);
    };

    dialog.addEventListener('close', handleNativeClose);
    dialog.addEventListener('cancel', handleCancel);

    // Fallback for browsers without native <dialog closedby="any"> support (e.g. Safari/iOS)
    let handlePointerDown: ((event: PointerEvent) => void) | null = null;
    let handlePointerUp: ((event: PointerEvent) => void) | null = null;
    if (!('closedBy' in HTMLDialogElement.prototype)) {
      const isOutside = (event: PointerEvent) => {
        const rect = dialog.getBoundingClientRect();
        return (
          event.clientX < rect.left ||
          event.clientX > rect.right ||
          event.clientY < rect.top ||
          event.clientY > rect.bottom
        );
      };
      let pressedOutside = false;
      handlePointerDown = (event: PointerEvent) => {
        if (!isTopModal(dialog) || dialog.hasAttribute('data-closing')) {
          pressedOutside = false;
          return;
        }
        pressedOutside = isOutside(event);
      };
      handlePointerUp = (event: PointerEvent) => {
        if (!isTopModal(dialog) || dialog.hasAttribute('data-closing')) {
          pressedOutside = false;
          return;
        }
        if (pressedOutside && isOutside(event)) {
          pressedOutside = false;
          event.stopPropagation();
          void closeDialogAnimated(dialog);
        } else {
          pressedOutside = false;
        }
      };
      dialog.addEventListener('pointerdown', handlePointerDown);
      dialog.addEventListener('pointerup', handlePointerUp);
    }

    return () => {
      removeModalFromStack(dialog);
      dialog.removeEventListener('close', handleNativeClose);
      dialog.removeEventListener('cancel', handleCancel);
      if (handlePointerDown) {
        dialog.removeEventListener('pointerdown', handlePointerDown);
      }
      if (handlePointerUp) {
        dialog.removeEventListener('pointerup', handlePointerUp);
      }
    };
  }, [dialogRef]);
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
      text: 'Bez terminu'
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

