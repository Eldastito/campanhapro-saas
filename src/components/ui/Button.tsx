import * as React from 'react';

type ButtonProps = {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  children: React.ReactNode;
} & React.ButtonHTMLAttributes<HTMLButtonElement>;

const Button = ({ children, variant = 'primary', className = '', ...props }: ButtonProps) => {
  const baseClasses = 'px-4 py-2 rounded-lg font-semibold transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-900 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 transform hover:-translate-y-0.5 hover:shadow-lg disabled:transform-none disabled:shadow-none';
  
  const variantClasses = {
    primary: 'bg-gradient-to-r from-[#4ac7f0] to-[#1abc9c] text-slate-900 hover:opacity-90 focus:ring-[#4ac7f0]',
    secondary: 'bg-slate-700 hover:bg-slate-600 focus:ring-slate-500',
    danger: 'bg-red-600 hover:bg-red-700 focus:ring-red-500',
    ghost: 'bg-transparent hover:bg-slate-700 focus:ring-slate-500',
  };

  return (
    <button className={`${baseClasses} ${variantClasses[variant]} ${className}`} {...props}>
      {children}
    </button>
  );
};

export default Button;