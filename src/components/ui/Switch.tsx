interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  id?: string;
}

const Switch = ({ checked, onChange, id }: SwitchProps) => {
  const handleToggle = () => {
    onChange(!checked);
  };

  return (
    <label htmlFor={id} className="flex items-center cursor-pointer">
      <div className="relative">
        <input
          id={id}
          type="checkbox"
          className="sr-only"
          checked={checked}
          onChange={handleToggle}
        />
        <div className={`block w-10 h-6 rounded-full transition-colors ${checked ? 'bg-[#1abc9c]' : 'bg-slate-600'}`}></div>
        <div className={`dot absolute left-1 top-1 bg-white w-4 h-4 rounded-full transition-transform ${checked ? 'transform translate-x-full' : ''}`}></div>
      </div>
    </label>
  );
};

export default Switch;