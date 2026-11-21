import { useEffect } from 'react';

/**
 * Moves the specular sheen of the nearest Liquid Glass surface to the pointer.
 *
 * Writes --spec-dx / --spec-dy (pixel offsets from the element centre) on the
 * hovered `.glass` element and flags it with data-specular so the material
 * can raise the sheen opacity. The sheen layer moves by transform, so these
 * writes stay on the compositor and never repaint the card or its shadow.
 * One delegated listener, at most one rAF per frame, no React state updates.
 */
export function useLiquidSpecular(enabled: boolean) {
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;
    const { matchMedia } = window;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (matchMedia('(prefers-reduced-transparency: reduce)').matches) return;
    if (!matchMedia('(hover: hover) and (pointer: fine)').matches) return;

    let frame = 0;
    let pending: PointerEvent | null = null;
    let active: HTMLElement | null = null;
    let lastDx = Number.NaN;
    let lastDy = Number.NaN;

    const release = () => {
      active?.removeAttribute('data-specular');
      active = null;
      lastDx = Number.NaN;
      lastDy = Number.NaN;
    };

    const apply = () => {
      frame = 0;
      const event = pending;
      pending = null;
      if (!event) return;
      const element =
        event.target instanceof Element
          ? event.target.closest<HTMLElement>('.glass')
          : null;
      if (!element) {
        release();
        return;
      }
      if (element !== active) {
        release();
        active = element;
      }
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const dx = Math.round(event.clientX - rect.left - rect.width / 2);
      const dy = Math.round(event.clientY - rect.top - rect.height / 2);
      if (Math.abs(dx - lastDx) < 2 && Math.abs(dy - lastDy) < 2) return;
      lastDx = dx;
      lastDy = dy;
      element.style.setProperty('--spec-dx', `${dx}px`);
      element.style.setProperty('--spec-dy', `${dy}px`);
      element.dataset.specular = 'true';
    };

    const handlePointerMove = (event: PointerEvent) => {
      pending = event;
      if (!frame) frame = window.requestAnimationFrame(apply);
    };

    const handlePointerOut = (event: PointerEvent) => {
      if (event.relatedTarget) return;
      release();
    };

    window.addEventListener('pointermove', handlePointerMove, { passive: true });
    document.documentElement.addEventListener('pointerout', handlePointerOut, { passive: true });
    window.addEventListener('blur', release);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      document.documentElement.removeEventListener('pointerout', handlePointerOut);
      window.removeEventListener('blur', release);
      if (frame) window.cancelAnimationFrame(frame);
      release();
    };
  }, [enabled]);
}
