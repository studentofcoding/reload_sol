import { toast } from 'react-hot-toast';

export const successAlert = (message: string) => {
  toast.success(message, {
    style: {
      background: '#1a2e23',
      color: '#fff',
      border: '1px solid rgba(255, 255, 255, 0.3)',
    },
    duration: 3000,
  });
};

export const warningAlert = (message: string) => {
  toast.error(message, {
    style: {
      background: '#2d1a1a',
      color: '#fff',
      border: '1px solid rgba(255, 255, 255, 0.3)',
    },
    duration: 3000,
  });
};

export const errorAlert = (message: string) => {
  toast.error(message, {
    style: {
      background: '#2d1a1a', 
      color: '#fff',
      border: '1px solid rgba(255, 255, 255, 0.3)',
    },
    duration: 3000,
  });
};