'use client';

import { FC } from 'react';
import { FaTimes } from 'react-icons/fa';

interface ChangeLogProps {
  isOpen: boolean;
  onClose: () => void;
}

const ChangeLog: FC<ChangeLogProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 w-[95%] max-w-[600px] mx-auto">
      <div className="shadow-lg p-4">
        <div className="flex justify-evenly items-center mb-2">
          <h5 className="text-white/80 font-light text-sm sm:text-base text-center sm:text-left">
            What&apos;s new: <br className="block sm:hidden" /><span className="font-semibold">All tx are now 4x faster (from 15 to 4 seconds) </span>
          </h5>
          <button 
            onClick={onClose}
            className="sm:p-2 p-1 text-white/70 hover:text-white transition-colors"
          >
            <FaTimes className="sm:w-5 sm:h-5 w-[10px] h-[10px]" />
          </button>
        </div>
      </div>
    </div>
  );
};

export default ChangeLog; 