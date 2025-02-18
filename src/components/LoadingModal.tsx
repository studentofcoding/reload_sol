"use client"
import React from 'react';

export default function LoadingModal() {
  return (
    <div className="z-50 w-screen md:w-full flex h-full min-h-screen top-0 left-0 bg-black/80 fixed">
      <div className='w-full h-screen bg-cover flex px-8 py-20 justify-center items-center backdrop-blur-md'>
        <div
          className={`inline-block h-[74px] w-[74px] animate-spin text-text_color-200 rounded-full border-8 border-solid border-[#f33eea] border-r-transparent align-[-0.125em] motion-reduce:animate-[spin_1.5s_linear_infinite] -mt-[35.5px] ml-[26.5px]`}
          role="status">
          <span
            className="!absolute !-m-px !h-px !w-px !overflow-hidden !whitespace-nowrap !border-0 !p-0 ![clip:rect(0,0,0,0)]"
          >Loading...</span>
        </div>
      </div>
    </div>
  );
};

