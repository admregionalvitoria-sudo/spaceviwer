import React from 'react';
import clsx from 'clsx';

interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  disabled?: boolean;
}

export const Toggle: React.FC<ToggleProps> = ({ checked, onChange, label, disabled = false }) => {
  return (
    <label
      className={clsx(
        'flex items-center justify-between cursor-pointer select-none py-1.5',
        disabled && 'opacity-50 cursor-not-allowed'
      )}
    >
      {label && <span className="text-sm text-neutral-800 font-sans pr-4">{label}</span>}
      <div className="relative">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => !disabled && onChange(e.target.checked)}
          className="sr-only"
          disabled={disabled}
        />
        {/* Track */}
        <div
          className={clsx(
            'w-10 h-5 rounded-full transition-colors duration-200 border',
            checked ? 'bg-neutral-900 border-neutral-900' : 'bg-neutral-200 border-neutral-300'
          )}
        />
        {/* Thumb */}
        <div
          className={clsx(
            'absolute left-0.5 top-0.5 w-4 h-4 rounded-full transition-transform duration-200 ease-out shadow-sm bg-white',
            checked ? 'translate-x-5' : 'translate-x-0 border border-neutral-200'
          )}
        />
      </div>
    </label>
  );
};

