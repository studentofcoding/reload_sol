"use client";
import { useEffect, useState, useRef } from 'react';

interface AnimatedSolValueProps {
  userCurrency: 'USD' | 'IDR';
}

const AnimatedSolValue = ({ userCurrency }: AnimatedSolValueProps) => {
  const [value, setValue] = useState(userCurrency === 'USD' ? 0 : 1000);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const startTimeRef = useRef<number | null>(null);
  
  useEffect(() => {
    // Reset to starting value when currency changes
    setValue(userCurrency === 'USD' ? 0 : 1000);
    
    // Clear any existing interval
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    
    const startValue = userCurrency === 'USD' ? 0 : 1000;
    const maxValue = userCurrency === 'USD' ? 60 : 1000000;
    const animationDuration = 1000; // Exactly 3 seconds
    
    // Set the start time
    startTimeRef.current = Date.now();
    
    // Create new interval
    intervalRef.current = setInterval(() => {
      const elapsedTime = Date.now() - (startTimeRef.current || 0);
      const progress = Math.min(elapsedTime / animationDuration, 1); // 0 to 1
      
      if (progress >= 1) {
        // Animation complete
        setValue(maxValue);
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
      } else {
        // Linear interpolation between start and max values
        const currentValue = startValue + (maxValue - startValue) * progress;
        setValue(currentValue);
      }
    }, 16); // ~60fps for smooth animation
    
    // Cleanup function
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [userCurrency]);
  
  // Format the value based on currency
  const formattedValue = userCurrency === 'USD'
    ? `$${Math.floor(value).toFixed(0)}`
    : `Rp ${Math.floor(value).toLocaleString('id-ID')}`;
    
  // Fixed width container to prevent layout shifts
  const containerStyle = {
    display: 'inline-block',
    minWidth: userCurrency === 'USD' ? '50px' : window.innerWidth < 768 ? '80px' : '110px',
    textAlign: 'center' as const,
    fontVariantNumeric: 'tabular-nums'
  };
  
  return (
    <span className="font-mono" style={containerStyle}>
      {formattedValue}
    </span>
  );
};

export default AnimatedSolValue;