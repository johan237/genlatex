// SPDX-License-Identifier: MIT

'use client';

import * as DropdownMenu from '@radix-ui/react-dropdown-menu';

export default function DropdownMenuComponent({ trigger, children, align = 'end' }) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        {trigger}
      </DropdownMenu.Trigger>
      
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="min-w-[220px] bg-white dark:bg-gray-800 rounded-md p-1 shadow-lg border border-gray-200 dark:border-gray-700 z-50"
          sideOffset={5}
          align={align}
        >
          {children}
          <DropdownMenu.Arrow className="fill-white dark:fill-gray-800" />
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

export function DropdownMenuItem({ children, onSelect, disabled, className = '' }) {
  return (
    <DropdownMenu.Item
      className={`text-sm text-gray-700 dark:text-gray-300 rounded-sm px-2 py-1.5 cursor-pointer outline-none hover:bg-gray-100 dark:hover:bg-gray-700 focus:bg-gray-100 dark:focus:bg-gray-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent ${className}`}
      onSelect={disabled ? undefined : onSelect}
      disabled={disabled}
    >
      {children}
    </DropdownMenu.Item>
  );
}

export function DropdownMenuSeparator() {
  return (
    <DropdownMenu.Separator className="h-px bg-gray-200 dark:bg-gray-700 my-1" />
  );
}
