import { FC } from 'react';

interface LoadingSpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const LoadingSpinner: FC<LoadingSpinnerProps> = ({ 
  size = 'md',
  className = ''
}) => {
  const sizeClasses = {
    sm: 'w-4 h-4',
    md: 'w-6 h-6',
    lg: 'w-8 h-8'
  };

  return (
    <div className={`inline-block ${sizeClasses[size]} ${className}`}>
      <div className="relative w-full h-full">
        <div className="absolute w-full h-full border-2 border-white/20 rounded-full"></div>
        <div className="absolute w-full h-full border-2 border-white rounded-full animate-spin border-t-transparent"></div>
      </div>
    </div>
  );
};

export default LoadingSpinner; 