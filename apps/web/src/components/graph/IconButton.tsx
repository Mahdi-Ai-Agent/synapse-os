import { Tooltip } from 'radix-ui';
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

/** A round glass icon button with a tooltip; `active` lights it in the accent colour. */
export const IconButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean; children: ReactNode; side?: 'top' | 'bottom' | 'left' | 'right' }>(
  function IconButton({ label, active = false, children, side = 'left', className = '', ...rest }, ref) {
    return (
      <Tooltip.Root delayDuration={350}>
        <Tooltip.Trigger asChild>
          <button ref={ref} aria-label={label} className={`icon-btn ${active ? 'is-active' : ''} ${className}`} {...rest}>{children}</button>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content side={side} sideOffset={8} className="tooltip">{label}</Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    );
  },
);
