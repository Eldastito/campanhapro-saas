import * as React from 'react';
import { InfoIcon } from '../icons';

interface ToastProps {
  message: string;
  type: 'info' | 'success' | 'error';
  onClose: () => void;
}

const toastConfig = {
  info: {
    icon: <InfoIcon className="text-sky-400" />,
    style: 'bg-slate-800 border-sky-500',
  },
  success: {
    icon: <InfoIcon className="text-green-400" />,
    style: 'bg-slate-800 border-green-500',
  },
  error: {
    icon: <InfoIcon className="text-red-400" />,
    style: 'bg-slate-800 border-red-500',
  },
};

const Toast = ({ message, type, onClose }: ToastProps) => {
  React.useEffect(() => {
    const timer = setTimeout(() => {
      onClose();
    }, 4000); // O toast desaparecerá após 4 segundos

    return () => {
      clearTimeout(timer);
    };
  }, [onClose]);

  const config = toastConfig[type];

  return (
    <div className={`fixed top-5 right-5 z-50`}>
      <div
        className={`animate-fade-in-down flex items-center p-4 max-w-sm w-full rounded-lg shadow-lg border-l-4 ${config.style}`}
        role="alert"
      >
        <div className="flex-shrink-0">
          {config.icon}
        </div>
        <div className="ml-3 text-sm font-normal text-slate-300">{message}</div>
        <button
          type="button"
          className="ml-auto -mx-1.5 -my-1.5 bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg focus:ring-2 focus:ring-slate-600 p-1.5 inline-flex h-8 w-8"
          onClick={onClose}
          aria-label="Close"
        >
          <span className="sr-only">Close</span>
          &times;
        </button>
      </div>
    </div>
  );
};

export default Toast;