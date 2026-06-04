import * as React from 'react';
import { Eye, EyeOff } from 'lucide-react';

type PasswordInputProps = {
  label: string;
  containerClassName?: string;
} & React.InputHTMLAttributes<HTMLInputElement>;

/**
 * Password field with a visibility toggle (eye icon on the right).
 * Mirrors the look & spacing of <Input> so it drops in wherever a
 * `<Input type="password" ... />` was used.
 */
const PasswordInput = ({
  label,
  id,
  containerClassName = '',
  ...props
}: PasswordInputProps) => {
  const [visible, setVisible] = React.useState(false);

  return (
    <div className={containerClassName}>
      <label htmlFor={id} className="block text-sm font-medium text-slate-300 mb-1">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          className="w-full bg-slate-700 border border-slate-600 rounded-md py-2 pl-3 pr-10 text-slate-50 focus:outline-none focus:ring-2 focus:ring-[#4ac7f0] focus:border-transparent transition"
          {...props}
        />
        <button
          type="button"
          aria-label={visible ? 'Ocultar senha' : 'Mostrar senha'}
          aria-pressed={visible}
          onClick={() => setVisible((v) => !v)}
          // tabIndex={-1} so keyboard tab-order still goes input → submit,
          // not getting trapped on the toggle.
          tabIndex={-1}
          className="absolute inset-y-0 right-0 flex items-center px-3 text-slate-400 hover:text-slate-200 focus:outline-none focus:text-slate-200 transition"
        >
          {visible ? (
            <EyeOff size={18} aria-hidden="true" />
          ) : (
            <Eye size={18} aria-hidden="true" />
          )}
        </button>
      </div>
    </div>
  );
};

export default PasswordInput;
