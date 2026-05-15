import * as React from 'react';

type InputProps = {
  label: string;
  containerClassName?: string;
} & React.InputHTMLAttributes<HTMLInputElement>;

const Input = ({ label, id, containerClassName = '', ...props }: InputProps) => {
  return (
    <div className={containerClassName}>
      <label htmlFor={id} className="block text-sm font-medium text-slate-300 mb-1">
        {label}
      </label>
      <input
        id={id}
        className="w-full bg-slate-700 border border-slate-600 rounded-md py-2 px-3 text-slate-50 focus:outline-none focus:ring-2 focus:ring-[#4ac7f0] focus:border-transparent transition"
        {...props}
      />
    </div>
  );
};

export default Input;