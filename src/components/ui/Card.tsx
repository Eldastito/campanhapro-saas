import * as React from 'react';

interface CardProps {
  children?: React.ReactNode;
  className?: string;
}

const Card = ({ children, className = '' }: CardProps) => {
  return (
    <div className={`bg-slate-900 rounded-xl shadow-lg p-4 sm:p-6 print-bg-transparent print-text-black ${className}`}>
      {children}
    </div>
  );
};

export default Card;